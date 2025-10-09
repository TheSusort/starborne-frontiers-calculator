/**
 * Test script to verify frontiers.cubedweb.net API authentication and response format
 * This is a one-off test to understand the API contract before implementing the full update script
 */

const API_BASE = 'https://frontiers.cubedweb.net';
const TEST_DEFINITION_ID = 'Legion_Attacker_Rare_1'; // Example from user's export

interface LoginResponse {
    success: boolean;
    message?: string;
}

interface SkillsResponse {
    // We'll discover the structure from the API response
    [key: string]: unknown;
}

async function testApiAuth() {
    console.log('Testing frontiers.cubedweb.net API...\n');

    // You'll need to set these environment variables with your credentials
    const username = process.env.CUBEDWEB_USERNAME;
    const password = process.env.CUBEDWEB_PASSWORD;

    if (!username || !password) {
        console.error('ERROR: Please set CUBEDWEB_USERNAME and CUBEDWEB_PASSWORD environment variables');
        process.exit(1);
    }

    try {
        // First, let's explore what endpoints are available
        console.log('Step 0: Exploring available endpoints...\n');

        const testEndpoints = [
            { path: '/rest/baseunit/skills', method: 'GET', params: `?unit_id=${TEST_DEFINITION_ID}` },
            { path: '/rest/baseunit/skills', method: 'POST', body: { unit_id: TEST_DEFINITION_ID } },
            { path: `/rest/baseunit/skills/${TEST_DEFINITION_ID}`, method: 'GET', params: '' },
            { path: '/api/baseunit/skills', method: 'GET', params: `?unit_id=${TEST_DEFINITION_ID}` },
            { path: '/api/baseunit/skills', method: 'POST', body: { unit_id: TEST_DEFINITION_ID } },
        ];

        for (const endpoint of testEndpoints) {
            console.log(`Testing: ${endpoint.method} ${endpoint.path}${endpoint.params || ''}`);

            const options: RequestInit = {
                method: endpoint.method,
                headers: {
                    'Content-Type': 'application/json',
                },
            };

            if (endpoint.body) {
                options.body = JSON.stringify(endpoint.body);
            }

            const response = await fetch(`${API_BASE}${endpoint.path}${endpoint.params || ''}`, options);
            console.log(`  Status: ${response.status} ${response.statusText}`);

            if (response.ok) {
                const data = await response.json();
                console.log('\n✅ Found working endpoint!');
                console.log(`${endpoint.method} ${endpoint.path}${endpoint.params || ''}`);
                console.log('\nResponse:');
                console.log(JSON.stringify(data, null, 2));
                return;
            }

            if (response.status !== 405 && response.status !== 404) {
                const text = await response.text();
                console.log(`  Body (first 100 chars): ${text.substring(0, 100)}`);
            }
            console.log('');
        }

        console.log('\n❌ None of the common endpoint patterns worked.');
        console.log('All returned 404 or 405 errors.');
        console.log('\nLet me try with Basic Auth...\n');

        // Try without authentication first - try GET with query params
        console.log('Attempt 1: Testing without authentication (GET)...');
        console.log('Test DefinitionId:', TEST_DEFINITION_ID);

        const skillsResponse1 = await fetch(`${API_BASE}/rest/baseunit/skills?unit_id=${TEST_DEFINITION_ID}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        console.log('Response status (no auth, GET):', skillsResponse1.status);

        if (skillsResponse1.ok) {
            const skillsData = await skillsResponse1.json() as SkillsResponse;
            console.log('\n✅ No authentication needed!');
            console.log('\nSkills API Response Structure:');
            console.log(JSON.stringify(skillsData, null, 2));

            console.log('\n✅ API test completed successfully!');
            console.log('\nNext steps:');
            console.log('1. Verify the response structure contains the 4 skill text fields');
            console.log('2. Map the response fields to our database columns:');
            console.log('   - active_skill_text');
            console.log('   - charge_skill_text');
            console.log('   - first_passive_skill_text');
            console.log('   - second_passive_skill_text');
            return;
        }

        const errorText1 = await skillsResponse1.text();
        console.log('Response body (no auth):', errorText1.substring(0, 200));

        // If that didn't work, try with Basic Auth
        console.log('\nAttempt 2: Testing with Basic Auth...');
        const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

        const skillsResponse2 = await fetch(`${API_BASE}/rest/baseunit/skills`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader,
            },
            body: JSON.stringify({
                unit_id: TEST_DEFINITION_ID,
            }),
        });

        console.log('Response status (Basic Auth):', skillsResponse2.status);

        if (skillsResponse2.ok) {
            const skillsData = await skillsResponse2.json() as SkillsResponse;
            console.log('\n✅ Basic Auth works!');
            console.log('\nSkills API Response Structure:');
            console.log(JSON.stringify(skillsData, null, 2));

            console.log('\n✅ API test completed successfully!');
            return;
        }

        const errorText2 = await skillsResponse2.text();
        console.log('Response body (Basic Auth):', errorText2.substring(0, 200));

        // If that didn't work, try the /login endpoint approach
        console.log('\nAttempt 3: Testing with session-based auth...');
        console.log('Step 3a: Getting initial session...');

        const initResponse = await fetch(`${API_BASE}/rest/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username,
                password,
            }),
        });

        console.log('Login response status:', initResponse.status);
        const loginText = await initResponse.text();
        console.log('Login response (first 200 chars):', loginText.substring(0, 200));

        // Extract cookies
        const cookies = initResponse.headers.get('set-cookie');
        console.log('Cookies received:', cookies ? 'Yes' : 'No');

        if (!cookies) {
            console.error('\n❌ Could not authenticate with the API');
            console.error('Tried:');
            console.error('1. No authentication');
            console.error('2. Basic Auth');
            console.error('3. Session-based auth');
            process.exit(1);
        }

        console.log('\nStep 3b: Fetching skills with session...');
        const skillsResponse3 = await fetch(`${API_BASE}/rest/baseunit/skills`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookies,
            },
            body: JSON.stringify({
                unit_id: TEST_DEFINITION_ID,
            }),
        });

        console.log('Skills response status (with session):', skillsResponse3.status);

        if (!skillsResponse3.ok) {
            const errorText3 = await skillsResponse3.text();
            console.error('Skills API error:', errorText3.substring(0, 500));
            process.exit(1);
        }

        const skillsData = await skillsResponse3.json() as SkillsResponse;
        console.log('\n✅ Session-based auth works!');
        console.log('\nSkills API Response Structure:');
        console.log(JSON.stringify(skillsData, null, 2));

        console.log('\n✅ API test completed successfully!');

    } catch (error) {
        console.error('Error testing API:', error);
        process.exit(1);
    }
}

// Run the test
testApiAuth();
