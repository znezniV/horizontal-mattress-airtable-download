require('dotenv').config();
const axios = require('axios');

// Airtable API configuration
const BASE_ID = process.env.BASE_ID;
const API_KEY = process.env.BASE_API_KEY;

async function checkAirtableAccess() {
  try {
    console.log('Checking Airtable access...');
    console.log(`Base ID: ${BASE_ID}`);
    console.log(`API Key: ${API_KEY.substring(0, 10)}...`);
    
    // Try to get the base metadata
    const response = await axios.get(
      `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Success! Tables in this base:');
    response.data.tables.forEach(table => {
      console.log(`- ${table.name} (ID: ${table.id})`);
    });
    
  } catch (error) {
    console.error('Error accessing Airtable:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Response data:', error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

checkAirtableAccess(); 