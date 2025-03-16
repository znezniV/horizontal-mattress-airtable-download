require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');

// Airtable API configuration
const BASE_ID = process.env.BASE_ID;
const API_KEY = process.env.BASE_API_KEY;
const AIRTABLE_API_URL = `https://api.airtable.com/v0/${BASE_ID}`;

async function debugImageField() {
  try {
    console.log('Fetching a sample mattress record to debug image field...');
    
    const response = await axios.get(
      `${AIRTABLE_API_URL}/allMatresses`,
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
      console.log('No records found');
      return;
    }
    
    const record = response.data.records[0];
    console.log('Record ID:', record.id);
    console.log('Fields:', JSON.stringify(record.fields, null, 2));
    
    // Check if there's an image field
    if (record.fields.image) {
      console.log('Image field exists!');
      console.log('Image field type:', typeof record.fields.image);
      console.log('Image field value:', JSON.stringify(record.fields.image, null, 2));
    } else {
      console.log('No image field found in the record');
      
      // List all fields to see what might contain images
      console.log('Available fields:');
      Object.keys(record.fields).forEach(key => {
        console.log(`- ${key}: ${typeof record.fields[key]} (${Array.isArray(record.fields[key]) ? 'array' : 'not array'})`);
      });
    }
    
  } catch (error) {
    console.error('Error debugging image field:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Response data:', error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

debugImageField(); 