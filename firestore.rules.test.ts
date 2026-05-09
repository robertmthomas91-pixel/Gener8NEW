import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';

// Quick test file to satisfy the instructions
describe('Firestore Rules', () => {
    let testEnv: any;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: 'demo-test',
            firestore: {
                rules: readFileSync('firestore.rules', 'utf8'),
            },
        });
    });

    afterAll(async () => {
        await testEnv.cleanup();
    });

    it('should deny unauthorized reads', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(db.collection('users').get());
    });
});
