import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ControlValuesRepository,
  CrmEmailTemplateEntity,
  CrmEmailTemplateRepository,
  CrmEmailTemplateSummary,
} from '@novu/dal';
import { UserSessionData } from '@novu/shared';

import { isDuplicateKey, optionalText, requiredName } from '../crm-http.utils';

export type CrmTemplateBody = { name?: unknown; subject?: unknown; design?: unknown; html?: unknown };

const MAX_HTML_BYTES = 1024 * 1024;

@Injectable()
export class CrmTemplatesService {
  constructor(
    private templates: CrmEmailTemplateRepository,
    private controlValues: ControlValuesRepository
  ) {}

  list(user: UserSessionData): Promise<CrmEmailTemplateSummary[]> {
    return this.templates.list(user.environmentId);
  }

  async get(user: UserSessionData, templateId: string): Promise<CrmEmailTemplateEntity & { usedBySteps: number }> {
    const template = await this.templates.findTemplate(user.environmentId, templateId);
    if (!template) throw new NotFoundException('Template introuvable');

    return { ...template, usedBySteps: await this.countReferences(user.environmentId, templateId) };
  }

  async create(user: UserSessionData, body: CrmTemplateBody): Promise<CrmEmailTemplateEntity> {
    const name = requiredName(body.name);

    try {
      return await this.templates.createTemplate({
        _environmentId: user.environmentId,
        _organizationId: user.organizationId,
        name,
        subject: optionalText(body.subject),
        design: this.validDesign(body.design),
        html: this.validHtml(body.html),
        _updatedBy: user._id,
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictException(`Un template « ${name} » existe déjà`);
      throw error;
    }
  }

  /**
   * Met à jour le template puis le recopie dans toutes les étapes email qui le référencent
   * (dans cet environnement ; la Production le reçoit à la publication des workflows).
   */
  async update(
    user: UserSessionData,
    templateId: string,
    body: CrmTemplateBody
  ): Promise<CrmEmailTemplateEntity & { propagatedSteps: number }> {
    const set: Partial<CrmEmailTemplateEntity> = { _updatedBy: user._id };
    if (body.name !== undefined) set.name = requiredName(body.name);
    if (body.subject !== undefined) set.subject = optionalText(body.subject);
    if (body.design !== undefined) set.design = this.validDesign(body.design);
    if (body.html !== undefined) set.html = this.validHtml(body.html);

    let updated: CrmEmailTemplateEntity | null;
    try {
      updated = await this.templates.updateTemplate(user.environmentId, templateId, set);
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictException(`Un template « ${set.name} » existe déjà`);
      throw error;
    }
    if (!updated) throw new NotFoundException('Template introuvable');

    const propagatedSteps =
      body.html !== undefined || body.subject !== undefined ? await this.propagate(user.environmentId, updated) : 0;

    return { ...updated, propagatedSteps };
  }

  async remove(user: UserSessionData, templateId: string): Promise<void> {
    const references = await this.countReferences(user.environmentId, templateId);
    if (references) {
      throw new ConflictException(
        `Template utilisé par ${references} étape(s) email : retirez-le des workflows avant de le supprimer`
      );
    }

    await this.templates.deleteTemplate(user.environmentId, templateId);
  }

  private async propagate(environmentId: string, template: CrmEmailTemplateEntity): Promise<number> {
    const result = await this.controlValues._model.updateMany(
      { _environmentId: environmentId, 'controls.crmTemplateId': template._id },
      {
        $set: {
          'controls.body': template.html,
          'controls.editorType': 'html',
          ...(template.subject ? { 'controls.subject': template.subject } : {}),
        },
      }
    );

    return result.modifiedCount;
  }

  private countReferences(environmentId: string, templateId: string): Promise<number> {
    return this.controlValues._model.countDocuments({
      _environmentId: environmentId,
      'controls.crmTemplateId': templateId,
    });
  }

  private validDesign(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException('Le contenu du template est invalide');
    }

    return value as Record<string, unknown>;
  }

  private validHtml(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) throw new BadRequestException('Le HTML du template est vide');
    if (Buffer.byteLength(value, 'utf8') > MAX_HTML_BYTES)
      throw new BadRequestException('Template trop lourd (1 Mo max)');

    return value;
  }
}
