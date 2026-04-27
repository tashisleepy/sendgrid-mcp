import { jest } from '@jest/globals';
import { SendGridService } from '../sendgrid.js';

// SAFETY GATE: integration tests hit the live SendGrid API and mutate the
// configured account. They are skipped unless RUN_INTEGRATION=1 is set
// alongside SENDGRID_API_KEY (ideally a sandbox account).
const describeIntegration = process.env.RUN_INTEGRATION && process.env.SENDGRID_API_KEY
  ? describe
  : describe.skip;

describeIntegration('SendGridService Integration Tests', () => {
  let service: SendGridService;

  beforeEach(() => {
    service = new SendGridService(process.env.SENDGRID_API_KEY!);
  });

  // Increase timeout for API calls
  jest.setTimeout(60000);

  describe('Contact Management', () => {
    let createdListId: string;

    afterAll(async () => {
      if (createdListId) {
        try {
          await service.deleteList(createdListId);
          
          // Wait a moment for deletion to process
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Verify list is deleted by trying to fetch it
          try {
            await service.getList(createdListId);
            throw new Error('List was not deleted');
          } catch (error: any) {
            // @sendgrid/client errors expose the HTTP status as
            // error.code (number) on newer versions and
            // error.response.statusCode on older / underlying axios errors.
            const status = error?.code ?? error?.response?.statusCode;
            expect(status).toBe(404);
          }
        } catch (error) {
          console.error('Error cleaning up test list:', error);
          throw error;
        }
      }
    });

    it('should create a list and add a contact', async () => {
      // Create a unique list name using timestamp
      const listName = `Test List ${new Date().getTime()}`;
      
      // Create the list
      const list = await service.createList(listName);
      createdListId = list.id;
      expect(list).toBeDefined();
      expect(list.name).toBe(listName);
      expect(list.id).toBeDefined();
      
      // Add a contact to the list
      const contact = {
        email: `test${new Date().getTime()}@example.com`,
        first_name: 'Test',
        last_name: 'User'
      };
      
      // Add contact and wait a moment for it to process
      const addContactResponse = await service.addContact(contact);
      expect(addContactResponse).toBeDefined();
      
      // Wait longer for the contact to be processed
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      // Add contact to list
      const addToListResponse = await service.addContactsToList(list.id, [contact.email]);
      expect(addToListResponse).toBeDefined();
      
      // Retry a few times to verify the contact was added
      let foundContact;
      for (let i = 0; i < 3; i++) {
        // Wait between retries
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Check for the contact
        const contacts = await service.getContactsByList(list.id);
        expect(contacts).toBeDefined();
        expect(contacts.length).toBeGreaterThan(0);
        
        // Try to find our contact
        foundContact = contacts.find(c => c.email === contact.email);
        if (foundContact) break;
      }
      
      expect(foundContact).toBeDefined();
      expect(foundContact?.email).toBe(contact.email);
    });
  });

  describe('listTemplates', () => {
    it('should return an array of templates', async () => {
      const templates = await service.listTemplates();
      
      expect(Array.isArray(templates)).toBe(true);
      if (templates.length > 0) {
        expect(templates[0]).toHaveProperty('id');
        expect(templates[0]).toHaveProperty('name');
        expect(templates[0]).toHaveProperty('generation');
      }
    });
  });

  describe('getStats', () => {
    it('should retrieve email statistics', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30); // Last 30 days
      
      const stats = await service.getStats({
        start_date: startDate.toISOString().split('T')[0],
        aggregated_by: 'day'
      });
      
      expect(Array.isArray(stats)).toBe(true);
      if (stats.length > 0) {
        expect(stats[0]).toHaveProperty('date');
        expect(stats[0]).toHaveProperty('stats');
        expect(Array.isArray(stats[0].stats)).toBe(true);
        if (stats[0].stats.length > 0) {
          expect(stats[0].stats[0]).toHaveProperty('metrics');
          expect(stats[0].stats[0].metrics).toHaveProperty('opens');
          expect(stats[0].stats[0].metrics).toHaveProperty('clicks');
        }
      }
    });
  });
});
