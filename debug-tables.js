require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');

// Airtable API configuration
const BASE_ID = process.env.BASE_ID;
const API_KEY = process.env.BASE_API_KEY;
const AIRTABLE_API_URL = `https://api.airtable.com/v0/${BASE_ID}`;

async function debugTableFields(tableName) {
  try {
    console.log(`Fetching a sample record from ${tableName}...`);
    
    const response = await axios.get(
      `${AIRTABLE_API_URL}/${encodeURIComponent(tableName)}`,
      {
        params: {
          maxRecords: 1,
          view: 'Grid view'
        },
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.data.records.length === 0) {
      console.log(`No records found in ${tableName}`);
      return;
    }
    
    const record = response.data.records[0];
    console.log(`Record ID: ${record.id}`);
    console.log(`Fields in ${tableName}:`, JSON.stringify(record.fields, null, 2));
    
    // List all fields
    console.log(`Available fields in ${tableName}:`);
    Object.keys(record.fields).forEach(key => {
      console.log(`- ${key}: ${typeof record.fields[key]} (${Array.isArray(record.fields[key]) ? 'array' : 'not array'})`);
    });
    
  } catch (error) {
    console.error(`Error debugging ${tableName}:`);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Response data:', error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

async function main() {
  await debugTableFields('photographer');
  console.log('\n----------------------------\n');
  await debugTableFields('location');
}

main(); 