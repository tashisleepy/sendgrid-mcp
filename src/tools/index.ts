import { SendGridService } from '../services/sendgrid.js';
import { SendGridContact, SendGridSingleSend } from '../types/index.js';

export const getToolDefinitions = () => [
  {
    name: 'delete_contacts',
    description: 'Delete contacts from your SendGrid account',
    inputSchema: {
      type: 'object',
      properties: {
        emails: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Array of email addresses to delete'
        }
      },
      required: ['emails']
    }
  },
  {
    name: 'list_contacts',
    description: 'List all contacts in your SendGrid account (paginated, capped at 10000)',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'add_contact',
    description: 'Add a contact to your SendGrid marketing contacts',
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Contact email address'
        },
        first_name: {
          type: 'string',
          description: 'Contact first name (optional)'
        },
        last_name: {
          type: 'string',
          description: 'Contact last name (optional)'
        },
        custom_fields: {
          type: 'object',
          description: 'Custom field values (optional)'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'create_contact_list',
    description: 'Create a new contact list in SendGrid',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the contact list'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'add_contacts_to_list',
    description: 'Add contacts to an existing SendGrid list. NOTE: This endpoint also creates contacts that do not already exist as a side effect of the upsert.',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: {
          type: 'string',
          description: 'ID of the contact list'
        },
        emails: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Array of email addresses to add to the list'
        }
      },
      required: ['list_id', 'emails']
    }
  },
  {
    name: 'create_template',
    description: 'Create a new dynamic email template (with version) in SendGrid',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the template'
        },
        subject: {
          type: 'string',
          description: 'Default subject line for the template'
        },
        html_content: {
          type: 'string',
          description: 'HTML content of the template'
        },
        plain_content: {
          type: 'string',
          description: 'Plain text content of the template'
        }
      },
      required: ['name', 'subject', 'html_content', 'plain_content']
    }
  },
  {
    name: 'get_template',
    description: 'Retrieve a SendGrid template by ID',
    inputSchema: {
      type: 'object',
      properties: {
        template_id: {
          type: 'string',
          description: 'ID of the template to retrieve'
        }
      },
      required: ['template_id']
    }
  },
  {
    name: 'delete_template',
    description: 'Delete a dynamic template from SendGrid',
    inputSchema: {
      type: 'object',
      properties: {
        template_id: {
          type: 'string',
          description: 'ID of the template to delete'
        }
      },
      required: ['template_id']
    }
  },
  {
    name: 'validate_email',
    description: 'Validate an email address using SendGrid',
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address to validate'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'get_stats',
    description: 'Get SendGrid email statistics',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format'
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (optional, must be on or after start_date)'
        },
        aggregated_by: {
          type: 'string',
          enum: ['day', 'week', 'month'],
          description: 'How to aggregate the statistics (optional)'
        }
      },
      required: ['start_date']
    }
  },
  {
    name: 'list_templates',
    description: 'List all email templates in your SendGrid account',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'delete_list',
    description: 'Delete a contact list from SendGrid',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: {
          type: 'string',
          description: 'ID of the contact list to delete'
        }
      },
      required: ['list_id']
    }
  },
  {
    name: 'list_contact_lists',
    description: 'List all contact lists in your SendGrid account',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'get_contacts_by_list',
    description: 'Get all contacts in a SendGrid list',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: {
          type: 'string',
          description: 'ID of the contact list'
        }
      },
      required: ['list_id']
    }
  },
  {
    name: 'list_verified_senders',
    description: 'List all verified sender identities in your SendGrid account',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'list_suppression_groups',
    description: 'List all unsubscribe groups in your SendGrid account',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'create_single_send_draft',
    description: 'Create a Single Send DRAFT to one or more contact lists. Does NOT send. Returns a single_send_id which must be passed to schedule_single_send (with confirm: true) to actually deliver. This two-step flow prevents accidental mass sends.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the single send'
        },
        list_ids: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Array of list IDs to send to'
        },
        subject: {
          type: 'string',
          description: 'Email subject line'
        },
        html_content: {
          type: 'string',
          description: 'HTML content of the email'
        },
        plain_content: {
          type: 'string',
          description: 'Plain text content of the email'
        },
        sender_id: {
          type: 'number',
          description: 'ID of the verified sender'
        },
        suppression_group_id: {
          type: 'number',
          description: 'ID of the suppression group for unsubscribes (required if custom_unsubscribe_url not provided)'
        },
        custom_unsubscribe_url: {
          type: 'string',
          description: 'Custom URL for unsubscribes (required if suppression_group_id not provided)'
        }
      },
      required: ['name', 'list_ids', 'subject', 'html_content', 'plain_content', 'sender_id']
    }
  },
  {
    name: 'schedule_single_send',
    description: 'Schedule a previously-created Single Send draft for delivery. Requires confirm: true to guard against accidental sends. Use send_at: "now" for immediate delivery or an ISO 8601 timestamp for scheduled delivery.',
    inputSchema: {
      type: 'object',
      properties: {
        single_send_id: {
          type: 'string',
          description: 'ID of the single send draft to schedule (returned by create_single_send_draft)'
        },
        send_at: {
          type: 'string',
          description: 'When to send: "now" for immediate or ISO 8601 timestamp (e.g. "2026-05-01T09:00:00Z")'
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to actually schedule the send. Required guard against accidental mass-email.'
        }
      },
      required: ['single_send_id', 'send_at', 'confirm']
    }
  },
  {
    name: 'get_single_send',
    description: 'Get details of a specific single send',
    inputSchema: {
      type: 'object',
      properties: {
        single_send_id: {
          type: 'string',
          description: 'ID of the single send to retrieve'
        }
      },
      required: ['single_send_id']
    }
  },
  {
    name: 'list_single_sends',
    description: 'List all single sends in your SendGrid account',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'remove_contacts_from_list',
    description: 'Remove contacts from a SendGrid list without deleting them',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: {
          type: 'string',
          description: 'ID of the contact list'
        },
        emails: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Array of email addresses to remove from the list'
        }
      },
      required: ['list_id', 'emails']
    }
  }
];

export const handleToolCall = async (service: SendGridService, name: string, args: any) => {
  switch (name) {
    case 'delete_contacts': {
      const requested = args.emails.length;
      const deleted = await service.deleteContactsByEmails(args.emails);
      const skipped = requested - deleted;
      const text = skipped > 0
        ? `Deleted ${deleted} of ${requested} contacts (${skipped} not found)`
        : `Deleted ${deleted} contacts`;
      return { content: [{ type: 'text', text }] };
    }

    case 'list_contacts': {
      const allContacts = await service.listAllContacts();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(allContacts.map(c => ({
            id: c.id,
            email: c.email,
            first_name: c.first_name,
            last_name: c.last_name
          })), null, 2)
        }]
      };
    }

    case 'add_contact': {
      await service.addContact(args as SendGridContact);
      return { content: [{ type: 'text', text: `Contact ${args.email} added successfully` }] };
    }

    case 'create_contact_list': {
      const list = await service.createList(args.name);
      return { content: [{ type: 'text', text: `Contact list "${args.name}" created with ID: ${list.id}` }] };
    }

    case 'add_contacts_to_list': {
      await service.addContactsToList(args.list_id, args.emails);
      return { content: [{ type: 'text', text: `Upserted ${args.emails.length} contacts to list ${args.list_id} (existing contacts updated, new emails created and added)` }] };
    }

    case 'create_template': {
      const template = await service.createTemplate(args);
      return { content: [{ type: 'text', text: `Template "${args.name}" created with ID: ${template.id}` }] };
    }

    case 'get_template': {
      const retrievedTemplate = await service.getTemplate(args.template_id);
      return { content: [{ type: 'text', text: JSON.stringify(retrievedTemplate, null, 2) }] };
    }

    case 'delete_template': {
      await service.deleteTemplate(args.template_id);
      return { content: [{ type: 'text', text: `Template ${args.template_id} deleted successfully` }] };
    }

    case 'validate_email': {
      const validation = await service.validateEmail(args.email);
      return { content: [{ type: 'text', text: JSON.stringify(validation, null, 2) }] };
    }

    case 'get_stats': {
      if (args.end_date && args.start_date && args.end_date < args.start_date) {
        throw new Error(`end_date (${args.end_date}) must be on or after start_date (${args.start_date})`);
      }
      const stats = await service.getStats(args);
      return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    }

    case 'list_templates': {
      const templates = await service.listTemplates();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(templates.map(t => ({
            id: t.id,
            name: t.name,
            generation: t.generation,
            updated_at: t.updated_at,
            versions: t.versions.length
          })), null, 2)
        }]
      };
    }

    case 'delete_list': {
      await service.deleteList(args.list_id);
      return { content: [{ type: 'text', text: `Contact list ${args.list_id} deleted successfully` }] };
    }

    case 'list_contact_lists': {
      const lists = await service.listContactLists();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(lists.map(l => ({
            id: l.id,
            name: l.name,
            contact_count: l.contact_count
          })), null, 2)
        }]
      };
    }

    case 'get_contacts_by_list': {
      const contacts = await service.getContactsByList(args.list_id);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(contacts.map(c => ({
            id: c.id,
            email: c.email,
            first_name: c.first_name,
            last_name: c.last_name
          })), null, 2)
        }]
      };
    }

    case 'list_verified_senders': {
      const senders = await service.getVerifiedSenders();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(senders, null, 2)
        }]
      };
    }

    case 'list_suppression_groups': {
      const groups = await service.getSuppressionGroups();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(groups, null, 2)
        }]
      };
    }

    case 'create_single_send_draft': {
      if (!args.suppression_group_id && !args.custom_unsubscribe_url) {
        throw new Error('Either suppression_group_id or custom_unsubscribe_url must be provided');
      }

      const newSingleSend = await service.createSingleSend({
        name: args.name,
        send_to: {
          list_ids: args.list_ids
        },
        email_config: {
          subject: args.subject,
          html_content: args.html_content,
          plain_content: args.plain_content,
          sender_id: args.sender_id,
          suppression_group_id: args.suppression_group_id,
          custom_unsubscribe_url: args.custom_unsubscribe_url
        }
      });

      return {
        content: [{
          type: 'text',
          text: `Draft "${args.name}" created with single_send_id: ${newSingleSend.id}. NOT YET SENT. Call schedule_single_send with this id and confirm: true to deliver.`
        }]
      };
    }

    case 'schedule_single_send': {
      if (args.confirm !== true) {
        throw new Error('schedule_single_send requires confirm: true to guard against accidental delivery. Pass confirm: true explicitly when you want to send.');
      }
      await service.scheduleSingleSend(args.single_send_id, args.send_at);
      const when = args.send_at === 'now' ? 'immediately' : `at ${args.send_at}`;
      return {
        content: [{
          type: 'text',
          text: `Single send ${args.single_send_id} scheduled to deliver ${when}.`
        }]
      };
    }

    case 'get_single_send': {
      const retrievedSingleSend = await service.getSingleSend(args.single_send_id);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: retrievedSingleSend.id,
            name: retrievedSingleSend.name,
            status: retrievedSingleSend.status,
            send_at: retrievedSingleSend.send_at,
            list_ids: retrievedSingleSend.send_to?.list_ids
          }, null, 2)
        }]
      };
    }

    case 'list_single_sends': {
      const allSingleSends = await service.listSingleSends();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(allSingleSends.map((s: SendGridSingleSend) => ({
            id: s.id,
            name: s.name,
            status: s.status,
            send_at: s.send_at
          })), null, 2)
        }]
      };
    }

    case 'remove_contacts_from_list': {
      const requested = args.emails.length;
      const removed = await service.removeContactsFromList(args.list_id, args.emails);
      const skipped = requested - removed;
      const text = skipped > 0
        ? `Removed ${removed} of ${requested} contacts from list ${args.list_id} (${skipped} not on list or not found)`
        : `Removed ${removed} contacts from list ${args.list_id}`;
      return { content: [{ type: 'text', text }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};
