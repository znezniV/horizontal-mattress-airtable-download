require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// Airtable API configuration
const BASE_ID = process.env.BASE_ID;
const API_KEY = process.env.BASE_API_KEY;
const AIRTABLE_API_URL = `https://api.airtable.com/v0/${BASE_ID}`;

// Correct table names from the Airtable base
const TABLES = {
  MATTRESSES: 'allMatresses',
  PHOTOGRAPHER: 'photographer',
  LOCATION: 'location'
};

// Define the output directory structure
const OUTPUT_DIR = 'data';
const IMAGES_DIR = path.join(OUTPUT_DIR, 'images');
const TABLES_DIR = path.join(OUTPUT_DIR, 'tables');

// Create directory structure
fs.ensureDirSync(OUTPUT_DIR);
fs.ensureDirSync(IMAGES_DIR);
fs.ensureDirSync(TABLES_DIR);

// Store all data
const data = {
  allMatresses: [],
  photographer: [],
  location: []
};

// Configuration for development
const CONFIG = {
  // Number of records to fetch from each table
  SAMPLE_SIZE: {
    [TABLES.MATTRESSES]: null, // null means fetch all
    // We'll fetch all photographers and locations
    [TABLES.PHOTOGRAPHER]: null, // null means fetch all
    [TABLES.LOCATION]: null // null means fetch all
  },
  // Delay between API requests in milliseconds
  API_DELAY: 1000
};

// Helper function to add delay between requests
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to make Airtable API requests with rate limiting and pagination
async function fetchAirtableRecords(tableName, maxRecords = null, offset = null) {
  console.log(`Fetching records from ${tableName}${offset ? ' with offset' : ''}...`);
  
  try {
    const params = { 
      view: 'Grid view',
      ...(maxRecords ? { maxRecords } : {}),
      ...(offset ? { offset } : {})
    };
    
    // Add delay before making the request
    await delay(CONFIG.API_DELAY);
    
    const response = await axios.get(
      `${AIRTABLE_API_URL}/${encodeURIComponent(tableName)}`,
      {
        params,
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const records = response.data.records;
    console.log(`Fetched ${records.length} records from ${tableName}`);
    
    // If there's more data to fetch (pagination)
    if (response.data.offset && !maxRecords) {
      const nextRecords = await fetchAirtableRecords(tableName, null, response.data.offset);
      return [...records, ...nextRecords];
    }
    
    return records;
    
  } catch (error) {
    if (error.response && error.response.status === 429) {
      console.error(`Rate limit exceeded for ${tableName}. Waiting 30 seconds before retrying...`);
      await delay(30000); // Wait 30 seconds before retrying
      return fetchAirtableRecords(tableName, maxRecords, offset);
    }
    
    console.error(`Error fetching records from ${tableName}:`, error.response?.data || error.message);
    throw error;
  }
}

// Download an image from a URL with rate limiting
async function downloadImage(url, filename) {
  try {
    // Add delay before making the request
    await delay(CONFIG.API_DELAY);
    
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream'
    });
    
    const writer = fs.createWriteStream(filename);
    
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    if (error.response && error.response.status === 429) {
      console.error(`Rate limit exceeded for image download. Waiting 30 seconds before retrying...`);
      await delay(30000); // Wait 30 seconds before retrying
      return downloadImage(url, filename);
    }
    
    console.error(`Error downloading image from ${url}:`, error.message);
    throw error;
  }
}

// Process and download images for a mattress record
async function processImages(record, recordId) {
  const images = record.fields.images || [];
  const imageData = [];
  
  if (!images.length) {
    return imageData;
  }
  
  const recordImagesDir = path.join(IMAGES_DIR, recordId);
  fs.ensureDirSync(recordImagesDir);
  
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const imageFilename = `${i + 1}.jpg`;
    const imagePath = path.join(recordImagesDir, imageFilename);
    const relativeImagePath = path.relative(OUTPUT_DIR, imagePath);
    
    // Check if the image already exists
    const imageExists = fs.existsSync(imagePath);
    let shouldDownload = true;
    
    if (imageExists) {
      try {
        // Get the file size of the existing image
        const stats = fs.statSync(imagePath);
        const existingSize = stats.size;
        
        // If the file size is the same (or very close), assume it's the same image
        // Allow for a small difference in size (1% tolerance)
        const sizeDifference = Math.abs(existingSize - image.size);
        const sizePercentDifference = (sizeDifference / image.size) * 100;
        
        if (sizePercentDifference < 1) {
          console.log(`Image ${i + 1} for record ${recordId} already exists with matching size. Skipping download.`);
          shouldDownload = false;
        } else {
          console.log(`Image ${i + 1} for record ${recordId} exists but size differs (${existingSize} vs ${image.size}). Re-downloading.`);
        }
      } catch (error) {
        console.error(`Error checking existing image ${imagePath}:`, error.message);
        // If there's an error checking the file, download it again to be safe
      }
    }
    
    try {
      if (shouldDownload) {
        console.log(`Downloading image ${i + 1} for record ${recordId}...`);
        await downloadImage(image.url, imagePath);
        console.log(`Downloaded image ${i + 1} for record ${recordId}`);
      }
      
      imageData.push({
        id: image.id,
        filename: imageFilename,
        originalFilename: image.filename,
        path: relativeImagePath,
        url: image.url,
        size: image.size,
        type: image.type
      });
    } catch (error) {
      console.error(`Failed to download image ${i + 1} for record ${recordId}: ${error.message}`);
    }
  }
  
  return imageData;
}

// Fetch photographers
async function fetchPhotographers() {
  console.log('Fetching photographers...');
  
  try {
    const records = await fetchAirtableRecords(TABLES.PHOTOGRAPHER, CONFIG.SAMPLE_SIZE[TABLES.PHOTOGRAPHER]);
    
    const photographers = records.map(record => ({
      id: record.id,
      name: record.fields.photographerName,
      // Add any other fields you need
    }));
    
    fs.writeJsonSync(path.join(TABLES_DIR, 'photographer.json'), photographers, { spaces: 2 });
    return photographers;
  } catch (error) {
    console.error('Error processing photographers:', error.message);
    throw error;
  }
}

// Fetch locations
async function fetchLocations() {
  console.log('Fetching locations...');
  
  try {
    const records = await fetchAirtableRecords(TABLES.LOCATION, CONFIG.SAMPLE_SIZE[TABLES.LOCATION]);
    
    const locations = records.map(record => ({
      id: record.id,
      name: record.fields.locationName,
      // Add any other fields you need
    }));
    
    fs.writeJsonSync(path.join(TABLES_DIR, 'location.json'), locations, { spaces: 2 });
    return locations;
  } catch (error) {
    console.error('Error processing locations:', error.message);
    throw error;
  }
}

// Fetch mattresses
async function fetchMattresses(photographers, locations) {
  console.log('Fetching mattresses...');
  
  try {
    const records = await fetchAirtableRecords(TABLES.MATTRESSES, CONFIG.SAMPLE_SIZE[TABLES.MATTRESSES]);
    const mattresses = [];
    
    for (const record of records) {
      console.log(`Processing mattress record: ${record.id}`);
      
      // Process images
      const images = await processImages(record, record.id);
      
      // Get photographer details
      const photographerIds = record.fields.photographer || [];
      const photographerDetails = photographerIds.map(id => {
        const photographer = photographers.find(p => p.id === id);
        // Return the full photographer object with name if found
        return photographer ? { ...photographer } : { id };
      });
      
      // Get location details
      const locationId = record.fields.location ? record.fields.location[0] : null;
      const locationDetails = locationId 
        ? (locations.find(l => l.id === locationId) || { id: locationId })
        : null;
      
      // Create mattress record
      const mattress = {
        id: record.id,
        date: record.fields.date,
        photographers: photographerDetails,
        location: locationDetails,
        images: images
      };
      
      mattresses.push(mattress);
    }
    
    fs.writeJsonSync(path.join(TABLES_DIR, 'allMatresses.json'), mattresses, { spaces: 2 });
    return mattresses;
  } catch (error) {
    console.error('Error processing mattresses:', error.message);
    throw error;
  }
}

// Main function to orchestrate the download
async function main() {
  try {
    console.log('Starting data download with all references...');
    console.log(`Data sizes: Mattresses=${CONFIG.SAMPLE_SIZE[TABLES.MATTRESSES] || 'ALL'}, Photographers=${CONFIG.SAMPLE_SIZE[TABLES.PHOTOGRAPHER] || 'ALL'}, Locations=${CONFIG.SAMPLE_SIZE[TABLES.LOCATION] || 'ALL'}`);
    console.log(`API delay: ${CONFIG.API_DELAY}ms between requests`);
    
    // Check if data already exists
    const photographerJsonPath = path.join(TABLES_DIR, 'photographer.json');
    const locationJsonPath = path.join(TABLES_DIR, 'location.json');
    const mattressesJsonPath = path.join(TABLES_DIR, 'allMatresses.json');
    const combinedJsonPath = path.join(OUTPUT_DIR, 'mattresses-data.json');
    
    const photographerExists = fs.existsSync(photographerJsonPath);
    const locationExists = fs.existsSync(locationJsonPath);
    const mattressesExists = fs.existsSync(mattressesJsonPath);
    
    // Fetch all data
    console.log('Downloading all photographers and locations first...');
    
    if (photographerExists) {
      console.log('Photographer data already exists. Loading from file...');
      data.photographer = fs.readJsonSync(photographerJsonPath);
      console.log(`Loaded ${data.photographer.length} photographers from file`);
    } else {
      data.photographer = await fetchPhotographers();
      console.log(`Downloaded ${data.photographer.length} photographers`);
    }
    
    if (locationExists) {
      console.log('Location data already exists. Loading from file...');
      data.location = fs.readJsonSync(locationJsonPath);
      console.log(`Loaded ${data.location.length} locations from file`);
    } else {
      data.location = await fetchLocations();
      console.log(`Downloaded ${data.location.length} locations`);
    }
    
    if (mattressesExists) {
      console.log('Mattress data already exists. Loading from file...');
      data.allMatresses = fs.readJsonSync(mattressesJsonPath);
      console.log(`Loaded ${data.allMatresses.length} mattresses from file`);
      
      // Even if we load from file, we still need to check and download any missing images
      console.log('Checking for missing images...');
      let imagesChecked = 0;
      let imagesDownloaded = 0;
      let imagesSkipped = 0;
      
      for (const mattress of data.allMatresses) {
        console.log(`Checking images for mattress: ${mattress.id}`);
        const originalImages = mattress.images.map(img => ({
          id: img.id,
          url: img.url,
          filename: img.originalFilename,
          size: img.size,
          type: img.type
        }));
        
        imagesChecked += originalImages.length;
        
        // Process images will handle checking if they exist and downloading if needed
        await processImages({ 
          id: mattress.id, 
          fields: { 
            images: originalImages
          } 
        }, mattress.id);
      }
      
      // Count total images after processing
      let totalImages = 0;
      let existingImages = 0;
      
      for (const mattress of data.allMatresses) {
        if (mattress.images && mattress.images.length > 0) {
          totalImages += mattress.images.length;
          
          for (let i = 0; i < mattress.images.length; i++) {
            const imagePath = path.join(IMAGES_DIR, mattress.id, `${i + 1}.jpg`);
            if (fs.existsSync(imagePath)) {
              existingImages++;
            }
          }
        }
      }
      
      console.log(`Images summary: Total: ${totalImages}, Downloaded: ${existingImages}, Missing: ${totalImages - existingImages}`);
    } else {
      console.log('Downloading all mattresses and linking with photographers and locations...');
      data.allMatresses = await fetchMattresses(data.photographer, data.location);
      console.log(`Downloaded ${data.allMatresses.length} mattresses`);
    }
    
    // Create the final combined JSON file
    fs.writeJsonSync(combinedJsonPath, data, { spaces: 2 });
    
    console.log('Download complete! Data has been saved to the data directory.');
  } catch (error) {
    console.error('Error downloading data:', error);
    process.exit(1);
  }
}

// Run the main function
main(); 