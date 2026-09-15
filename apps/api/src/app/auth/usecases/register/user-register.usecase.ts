import { BadRequestException, Injectable } from '@nestjs/common';
import { AnalyticsService } from '@novu/application-generic';
import { MemberRepository, OrganizationEntity, UserRepository } from '@novu/dal';
import { MemberStatusEnum, normalizeEmail, SignUpOriginEnum } from '@novu/shared';
import { hash } from 'bcrypt';
import { CreateOrganizationCommand } from '../../../organization/usecases/create-organization/create-organization.command';
import { CreateOrganization } from '../../../organization/usecases/create-organization/create-organization.usecase';
import { AuthService } from '../../services/auth.service';
import { UserRegisterCommand } from './user-register.command';

@Injectable()
export class UserRegister {
  constructor(
    private authService: AuthService,
    private userRepository: UserRepository,
    private createOrganizationUsecase: CreateOrganization,
    private analyticsService: AnalyticsService,
    private memberRepository: MemberRepository
  ) {}

  async execute(command: UserRegisterCommand) {
    const email = normalizeEmail(command.email);

    // izipush : inscriptions publiques fermées, sauf pour une personne invitée (jeton valide, même adresse).
    if (process.env.DISABLE_USER_REGISTRATION === 'true') {
      const invited = command.invitationToken
        ? await this.memberRepository.findByInviteToken(command.invitationToken)
        : null;
      const isValidInvite =
        invited?.memberStatus === MemberStatusEnum.INVITED &&
        !!invited.invite &&
        normalizeEmail(invited.invite.email) === email;
      if (!isValidInvite) throw new BadRequestException('Account creation is disabled');
    }
    const existingUser = await this.userRepository.findByEmail(email);
    if (existingUser) throw new BadRequestException('User already exists');

    const passwordHash = await hash(command.password, 10);
    const user = await this.userRepository.create({
      email,
      firstName: command.firstName.toLowerCase(),
      lastName: command.lastName?.toLowerCase(),
      password: passwordHash,
    });

    let organization: OrganizationEntity;
    if (command.organizationName) {
      organization = await this.createOrganizationUsecase.execute(
        CreateOrganizationCommand.create({
          name: command.organizationName,
          userId: user._id,
          jobTitle: command.jobTitle,
          domain: command.domain,
          language: command.language,
        })
      );
    }

    this.analyticsService.upsertUser(user, user._id);

    this.analyticsService.track('[Authentication] - Signup', user._id, {
      loginType: 'email',
      origin: command.origin || SignUpOriginEnum.WEB,
      wasInvited: Boolean(command.wasInvited),
    });

    return {
      user: await this.userRepository.findById(user._id),
      token: await this.authService.generateUserToken(user),
    };
  }
}
