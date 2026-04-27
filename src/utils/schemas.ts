// Zod schemas for runtime validation of every tool's arguments.
//
// MCP SDK 0.6.0 declares JSON Schema in tool definitions but does not enforce
// it at runtime — `args` arrives as `any`. These schemas are the actual gate.
//
// Validation happens at the entry of handleToolCall. On failure the user
// gets a clean structured error instead of an opaque API roundtrip failure.

import { z } from 'zod';

// SendGrid IDs are alphanumeric with hyphens/underscores (UUIDs, dynamic
// template ids like d-abc123). The same pattern enforced server-side in
// validateSendGridId — duplicating here lets us reject early and clearly.
const sendGridId = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Must be alphanumeric with optional hyphens/underscores');

const email = z.string().email('Must be a valid email address');

const isoDateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

export const TOOL_SCHEMAS = {
  delete_contacts: z.object({
    emails: z.array(email).min(1, 'emails must be a non-empty array'),
  }),

  list_contacts: z.object({}).strict(),

  add_contact: z.object({
    email,
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    custom_fields: z.record(z.string(), z.any()).optional(),
  }),

  create_contact_list: z.object({
    name: z.string().min(1, 'name is required'),
  }),

  add_contacts_to_list: z.object({
    list_id: sendGridId,
    emails: z.array(email).min(1),
  }),

  create_template: z.object({
    name: z.string().min(1),
    subject: z.string().min(1),
    html_content: z.string(),
    plain_content: z.string(),
  }),

  get_template: z.object({ template_id: sendGridId }),
  delete_template: z.object({ template_id: sendGridId }),
  validate_email: z.object({ email }),

  get_stats: z
    .object({
      start_date: isoDateOnly,
      end_date: isoDateOnly.optional(),
      aggregated_by: z.enum(['day', 'week', 'month']).optional(),
    })
    .refine(
      (v) => !v.end_date || v.end_date >= v.start_date,
      { message: 'end_date must be on or after start_date', path: ['end_date'] }
    ),

  list_templates: z.object({}).strict(),
  delete_list: z.object({ list_id: sendGridId }),
  list_contact_lists: z.object({}).strict(),
  get_contacts_by_list: z.object({ list_id: sendGridId }),
  list_verified_senders: z.object({}).strict(),
  list_suppression_groups: z.object({}).strict(),

  create_single_send_draft: z
    .object({
      name: z.string().min(1),
      list_ids: z.array(sendGridId).min(1),
      subject: z.string().min(1),
      html_content: z.string(),
      plain_content: z.string(),
      sender_id: z.number().int().positive(),
      suppression_group_id: z.number().int().positive().optional(),
      custom_unsubscribe_url: z.string().url().optional(),
    })
    .refine(
      (v) => v.suppression_group_id !== undefined || v.custom_unsubscribe_url !== undefined,
      { message: 'Either suppression_group_id or custom_unsubscribe_url is required' }
    ),

  schedule_single_send: z.object({
    single_send_id: sendGridId,
    send_at: z
      .string()
      .refine(
        (v) => v === 'now' || (!Number.isNaN(Date.parse(v)) && Date.parse(v) >= Date.now()),
        { message: 'send_at must be "now" or an ISO 8601 timestamp in the future' }
      ),
    confirm: z.literal(true, {
      message: 'confirm must be exactly true to authorize delivery',
    }),
  }),

  get_single_send: z.object({ single_send_id: sendGridId }),
  list_single_sends: z.object({}).strict(),

  remove_contacts_from_list: z.object({
    list_id: sendGridId,
    emails: z.array(email).min(1),
  }),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

export function validateToolArgs<T extends ToolName>(
  name: T,
  args: unknown
): z.infer<(typeof TOOL_SCHEMAS)[T]> {
  const schema = TOOL_SCHEMAS[name];
  if (!schema) {
    // Caller should have rejected unknown tool names BEFORE calling this,
    // but guard anyway so an unknown name produces a clean error rather
    // than an opaque "cannot read properties of undefined".
    throw new Error(`Unknown tool: ${name}`);
  }
  const result = schema.safeParse(args);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid arguments for ${name}: ${issues}`);
  }
  return result.data as z.infer<(typeof TOOL_SCHEMAS)[T]>;
}

// Tools that MUTATE the SendGrid account. Used for the read-only safety mode.
export const DESTRUCTIVE_TOOLS: ReadonlySet<string> = new Set([
  'delete_contacts',
  'add_contact',
  'create_contact_list',
  'add_contacts_to_list',
  'create_template',
  'delete_template',
  'delete_list',
  'create_single_send_draft',
  'schedule_single_send',
  'remove_contacts_from_list',
]);
