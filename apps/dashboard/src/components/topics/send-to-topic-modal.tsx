import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { TriggerRecipientsTypeEnum, WorkflowStatusEnum } from '@novu/shared';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { RiSendPlaneFill } from 'react-icons/ri';
import { z } from 'zod';
import { Badge } from '@/components/primitives/badge';
import { Button } from '@/components/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/primitives/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormRoot,
} from '@/components/primitives/form/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/select';
import { showErrorToast, showSuccessToast } from '@/components/primitives/sonner-helpers';
import { Textarea } from '@/components/primitives/textarea';
import { useFetchWorkflowTestData } from '@/hooks/use-fetch-workflow-test-data';
import { useFetchWorkflows } from '@/hooks/use-fetch-workflows';
import { useTriggerWorkflow } from '@/hooks/use-trigger-workflow';
import { formatCountForTooltip } from '@/utils/format-count';
import { buildDefaultValuesOfDataSchema } from '@/utils/schema';
import { useTopicSubscriptions } from './hooks/use-topic-subscribers';

const SendToTopicFormSchema = z.object({
  workflowId: z.string().min(1, 'Select the workflow to run for each subscriber'),
  payload: z.string().refine((value) => {
    if (!value.trim()) {
      return true;
    }

    try {
      const parsed = JSON.parse(value);

      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }, 'Payload must be a valid JSON object'),
});

type SendToTopicFormValues = z.infer<typeof SendToTopicFormSchema>;

type SendToTopicFormProps = {
  topicKey: string;
  topicName?: string;
  onSuccess: () => void;
  onCancel: () => void;
};

const SendToTopicForm = (props: SendToTopicFormProps) => {
  const { topicKey, topicName, onSuccess, onCancel } = props;

  const { data: workflowsData, isPending: isLoadingWorkflows } = useFetchWorkflows({ limit: 100 });
  // limit 1: we only need the total, not the subscriber list itself.
  const { data: subscriptionData, isPending: isLoadingSubscriptions } = useTopicSubscriptions(topicKey, { limit: 1 });
  const { triggerWorkflow, isPending: isTriggering } = useTriggerWorkflow();

  // Prefilling the payload from the workflow schema must not clobber the user's
  // own edits, so we only do it while the field is still untouched.
  const [isPayloadDirty, setIsPayloadDirty] = useState(false);

  const workflows = workflowsData?.workflows ?? [];
  const subscriberCount = subscriptionData?.totalCount ?? 0;
  const displayCount = formatCountForTooltip(subscriberCount, subscriptionData?.totalCountCapped ?? false);

  const form = useForm({
    defaultValues: {
      workflowId: '',
      payload: '',
    },
    resolver: standardSchemaResolver(SendToTopicFormSchema),
    shouldFocusError: false,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const selectedWorkflowId = form.watch('workflowId');
  const selectedWorkflow = workflows.find((workflow) => workflow.workflowId === selectedWorkflowId);

  const { testData } = useFetchWorkflowTestData({ workflowSlug: selectedWorkflow?.slug ?? '' });

  useEffect(() => {
    if (isPayloadDirty || !testData?.payload) {
      return;
    }

    // Keys the schema left undefined are dropped by stringify, so an empty
    // schema yields "{}" rather than a misleading skeleton.
    const defaults = JSON.stringify(buildDefaultValuesOfDataSchema(testData.payload), null, 2);
    form.setValue('payload', defaults === '{}' ? '' : defaults);
  }, [testData, isPayloadDirty, form]);

  const onSubmit = async (values: SendToTopicFormValues) => {
    try {
      const { data } = await triggerWorkflow({
        name: values.workflowId,
        to: [{ type: TriggerRecipientsTypeEnum.TOPIC, topicKey }],
        payload: values.payload.trim() ? JSON.parse(values.payload) : {},
      });

      if (!data?.transactionId) {
        showErrorToast(
          data?.error?.join(' ') ??
            `Workflow ${selectedWorkflow?.name ?? values.workflowId} could not be triggered. Make sure it is active and has at least one step.`,
          'Nothing was sent'
        );

        return;
      }

      showSuccessToast(
        `${selectedWorkflow?.name ?? values.workflowId} is running for the subscribers of ${topicKey}. Transaction ID: ${data.transactionId}`,
        'Sent to topic'
      );
      onSuccess();
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to send to the topic', 'Nothing was sent');
    }
  };

  const hasNoSubscribers = !isLoadingSubscriptions && subscriberCount === 0;

  return (
    <Form {...form}>
      <FormRoot
        id="send-to-topic-form"
        autoComplete="off"
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-3"
      >
        <DialogHeader>
          <DialogTitle>Send to topic</DialogTitle>
          <DialogDescription className="text-foreground-600 text-xs">
            The workflow you pick below runs once for every subscriber of{' '}
            <span className="font-medium">{topicName ?? topicKey}</span> — each one gets their own notification,
            resolved against their own channels and preferences.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="bg-bg-weak flex items-center justify-between rounded-lg px-3 py-2">
            <span className="text-foreground-600 text-xs">Recipients</span>
            <span className="text-xs font-medium">
              {isLoadingSubscriptions ? '…' : `${displayCount} subscriber(s)`}
            </span>
          </div>

          {hasNoSubscribers && (
            <p className="text-warning text-xs">
              This topic has no subscribers yet, so the trigger would reach nobody. Add subscribers first.
            </p>
          )}

          <FormField
            control={form.control}
            name="workflowId"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel htmlFor={field.name}>
                  Workflow to run <span className="text-primary">*</span>
                </FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    // A different workflow expects a different payload, so let
                    // the prefill take over again.
                    setIsPayloadDirty(false);
                    field.onChange(value);
                  }}
                  disabled={isLoadingWorkflows}
                >
                  <FormControl>
                    <SelectTrigger id={field.name} aria-invalid={!!fieldState.error}>
                      <SelectValue placeholder={isLoadingWorkflows ? 'Loading workflows…' : 'Select a workflow'} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {workflows.map((workflow) => (
                      <SelectItem key={workflow._id} value={workflow.workflowId}>
                        <div className="flex items-center gap-2">
                          <span>{workflow.name}</span>
                          {workflow.status !== WorkflowStatusEnum.ACTIVE && (
                            <Badge size="sm" variant="lighter" color="gray">
                              {workflow.status.toLowerCase()}
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {selectedWorkflow && selectedWorkflow.status !== WorkflowStatusEnum.ACTIVE && (
            <p className="text-warning text-xs">
              This workflow is {selectedWorkflow.status.toLowerCase()} — triggering it will not deliver anything until
              it is active.
            </p>
          )}

          <FormField
            control={form.control}
            name="payload"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel htmlFor={field.name}>Payload</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    simple
                    id={field.name}
                    className="font-code min-h-[120px]"
                    placeholder="{}"
                    hasError={!!fieldState.error}
                    onChange={(event) => {
                      setIsPayloadDirty(true);
                      field.onChange(event);
                    }}
                  />
                </FormControl>
                <FormMessage>
                  Variables available to every step of the workflow. Prefilled from the workflow schema.
                </FormMessage>
              </FormItem>
            )}
          />
        </div>

        <DialogFooter>
          <Button type="button" size="sm" mode="outline" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            trailingIcon={RiSendPlaneFill}
            isLoading={isTriggering}
            disabled={hasNoSubscribers}
          >
            Send to {displayCount} subscriber(s)
          </Button>
        </DialogFooter>
      </FormRoot>
    </Form>
  );
};

type SendToTopicModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topicKey: string;
  topicName?: string;
};

export const SendToTopicModal = (props: SendToTopicModalProps) => {
  const { open, onOpenChange, topicKey, topicName } = props;

  return (
    <Dialog modal open={open} onOpenChange={onOpenChange}>
      {/* Rendered only while open, so the workflow and subscriber queries stay idle otherwise. */}
      <DialogContent className="w-[520px] max-w-[520px]">
        <SendToTopicForm
          topicKey={topicKey}
          topicName={topicName}
          onSuccess={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
};
