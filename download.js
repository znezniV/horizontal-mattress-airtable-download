require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const ora = require('ora');

// Helper function for consistent logging
const log = {
  info: (message) => console.log(`ℹ️  ${message}`),
  success: (message) => console.log(`✅ ${message}`),
  warning: (message) => console.log(`⚠️  ${message}`),
  error: (message) => console.error(`❌ ${message}`),
  spinner: (message) => ora(message)
};

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
  const spinner = log.spinner(`Fetching records from ${tableName}${offset ? ' with offset' : ''}...`).start();
  
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
    spinner.succeed(`Fetched ${records.length} records from ${tableName}`);
    
    // If there's more data to fetch (pagination)
    if (response.data.offset && !maxRecords) {
      const nextRecords = await fetchAirtableRecords(tableName, null, response.data.offset);
      return [...records, ...nextRecords];
    }
    
    return records;
    
  } catch (error) {
    if (error.response && error.response.status === 429) {
      spinner.warn(`Rate limit exceeded for ${tableName}. Waiting 30 seconds before retrying...`);
      await delay(30000); // Wait 30 seconds before retrying
      return fetchAirtableRecords(tableName, maxRecords, offset);
    }
    
    spinner.fail(`Error fetching records from ${tableName}: ${error.response?.data || error.message}`);
    throw error;
  }
}

// Download an image from a URL with rate limiting
async function downloadImage(url, filename) {
  const spinner = log.spinner(`Downloading image ${path.basename(filename)}...`).start();
  
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
      writer.on('finish', () => {
        spinner.succeed(`Downloaded ${path.basename(filename)}`);
        resolve();
      });
      writer.on('error', (err) => {
        spinner.fail(`Error writing ${path.basename(filename)}: ${err.message}`);
        reject(err);
      });
    });
  } catch (error) {
    if (error.response && error.response.status === 429) {
      spinner.warn(`Rate limit exceeded for image download. Waiting 30 seconds before retrying...`);
      await delay(30000); // Wait 30 seconds before retrying
      return downloadImage(url, filename);
    }
    
    spinner.fail(`Error downloading image: ${error.message}`);
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
  
  log.info(`Processing ${images.length} images for record ${recordId}`);
  
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
          log.info(`Image ${i + 1} for record ${recordId} already exists with matching size. Skipping download.`);
          shouldDownload = false;
        } else {
          log.warning(`Image ${i + 1} for record ${recordId} exists but size differs (${existingSize} vs ${image.size}). Re-downloading.`);
        }
      } catch (error) {
        log.error(`Error checking existing image ${imagePath}: ${error.message}`);
        // If there's an error checking the file, download it again to be safe
      }
    }
    
    try {
      if (shouldDownload) {
        await downloadImage(image.url, imagePath);
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
      log.error(`Failed to download image ${i + 1} for record ${recordId}: ${error.message}`);
    }
  }
  
  return imageData;
}

// Fetch photographers
async function fetchPhotographers() {
  const spinner = log.spinner('Fetching photographers...').start();
  
  try {
    const records = await fetchAirtableRecords(TABLES.PHOTOGRAPHER, CONFIG.SAMPLE_SIZE[TABLES.PHOTOGRAPHER]);
    
    const photographers = records.map(record => ({
      id: record.id,
      name: record.fields.photographerName,
      // Add any other fields you need
    }));
    
    fs.writeJsonSync(path.join(TABLES_DIR, 'photographer.json'), photographers, { spaces: 2 });
    spinner.succeed(`Processed ${photographers.length} photographers`);
    return photographers;
  } catch (error) {
    spinner.fail(`Error processing photographers: ${error.message}`);
    throw error;
  }
}

// Fetch locations
async function fetchLocations() {
  const spinner = log.spinner('Fetching locations...').start();
  
  try {
    const records = await fetchAirtableRecords(TABLES.LOCATION, CONFIG.SAMPLE_SIZE[TABLES.LOCATION]);
    
    const locations = records.map(record => ({
      id: record.id,
      name: record.fields.locationName,
      // Add any other fields you need
    }));
    
    fs.writeJsonSync(path.join(TABLES_DIR, 'location.json'), locations, { spaces: 2 });
    spinner.succeed(`Processed ${locations.length} locations`);
    return locations;
  } catch (error) {
    spinner.fail(`Error processing locations: ${error.message}`);
    throw error;
  }
}

// Fetch mattresses
async function fetchMattresses(photographers, locations) {
  const spinner = log.spinner('Fetching mattresses...').start();
  
  try {
    const records = await fetchAirtableRecords(TABLES.MATTRESSES, CONFIG.SAMPLE_SIZE[TABLES.MATTRESSES]);
    const mattresses = [];
    spinner.succeed(`Fetched ${records.length} mattress records, processing...`);
    
    const progressSpinner = log.spinner(`Processing mattress records: 0/${records.length}`).start();
    
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      progressSpinner.text = `Processing mattress record: ${i+1}/${records.length} (${record.id})`;
      
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
    
    progressSpinner.succeed(`Processed ${mattresses.length} mattress records`);
    
    fs.writeJsonSync(path.join(TABLES_DIR, 'allMatresses.json'), mattresses, { spaces: 2 });
    return mattresses;
  } catch (error) {
    log.error(`Error processing mattresses: ${error.message}`);
    throw error;
  }
}

// Main function to orchestrate the download
async function main() {
  try {
    log.info('╔════════════════════════════════════════════════════════════╗');
    log.info('║                HORIZONTAL MATTRESS DOWNLOADER              ║');
    log.info('╚════════════════════════════════════════════════════════════╝');
    log.info(`Data sizes: Mattresses=${CONFIG.SAMPLE_SIZE[TABLES.MATTRESSES] || 'ALL'}, Photographers=${CONFIG.SAMPLE_SIZE[TABLES.PHOTOGRAPHER] || 'ALL'}, Locations=${CONFIG.SAMPLE_SIZE[TABLES.LOCATION] || 'ALL'}`);
    log.info(`API delay: ${CONFIG.API_DELAY}ms between requests`);
    
    // Check if data already exists
    const photographerJsonPath = path.join(TABLES_DIR, 'photographer.json');
    const locationJsonPath = path.join(TABLES_DIR, 'location.json');
    const mattressesJsonPath = path.join(TABLES_DIR, 'allMatresses.json');
    const combinedJsonPath = path.join(OUTPUT_DIR, 'mattresses-data.json');
    
    const photographerExists = fs.existsSync(photographerJsonPath);
    const locationExists = fs.existsSync(locationJsonPath);
    const mattressesExists = fs.existsSync(mattressesJsonPath);
    
    // Fetch all data
    log.info('Starting data download process...');
    
    if (photographerExists) {
      log.info('Photographer data already exists. Loading from file...');
      data.photographer = fs.readJsonSync(photographerJsonPath);
      log.success(`Loaded ${data.photographer.length} photographers from file`);
    } else {
      data.photographer = await fetchPhotographers();
      log.success(`Downloaded ${data.photographer.length} photographers`);
    }
    
    if (locationExists) {
      log.info('Location data already exists. Loading from file...');
      data.location = fs.readJsonSync(locationJsonPath);
      log.success(`Loaded ${data.location.length} locations from file`);
    } else {
      data.location = await fetchLocations();
      log.success(`Downloaded ${data.location.length} locations`);
    }
    
    if (mattressesExists) {
      log.info('Mattress data already exists. Loading from file...');
      data.allMatresses = fs.readJsonSync(mattressesJsonPath);
      log.success(`Loaded ${data.allMatresses.length} mattresses from file`);
      
      // Even if we load from file, we still need to check and download any missing images
      log.info('Checking for missing images...');
      
      const imageSpinner = log.spinner('Processing images from existing mattress data...').start();
      let totalImages = 0;
      
      for (const mattress of data.allMatresses) {
        imageSpinner.text = `Processing images for mattress: ${mattress.id}`;
        const originalImages = mattress.images.map(img => ({
          id: img.id,
          url: img.url,
          filename: img.originalFilename,
          size: img.size,
          type: img.type
        }));
        
        totalImages += originalImages.length;
        
        // Process images will handle checking if they exist and downloading if needed
        await processImages({ 
          id: mattress.id, 
          fields: { 
            images: originalImages
          } 
        }, mattress.id);
      }
      
      // Count total images after processing
      let existingImages = 0;
      
      for (const mattress of data.allMatresses) {
        if (mattress.images && mattress.images.length > 0) {
          for (let i = 0; i < mattress.images.length; i++) {
            const imagePath = path.join(IMAGES_DIR, mattress.id, `${i + 1}.jpg`);
            if (fs.existsSync(imagePath)) {
              existingImages++;
            }
          }
        }
      }
      
      imageSpinner.succeed(`Images processed: ${existingImages}/${totalImages} (${totalImages - existingImages} missing)`);
    } else {
      log.info('Downloading all mattresses and linking with photographers and locations...');
      data.allMatresses = await fetchMattresses(data.photographer, data.location);
      log.success(`Downloaded ${data.allMatresses.length} mattresses`);
    }
    
    // Create the final combined JSON file
    const finalSpinner = log.spinner('Creating combined data file...').start();
    fs.writeJsonSync(combinedJsonPath, data, { spaces: 2 });
    finalSpinner.succeed('Combined data file created successfully');
    
    log.success('╔════════════════════════════════════════════════════════════╗');
    log.success('║                    DOWNLOAD COMPLETE!                      ║');
    log.success('╚════════════════════════════════════════════════════════════╝');
    log.success(`Data has been saved to the ${OUTPUT_DIR} directory`);
    log.info(`Total photographers: ${data.photographer.length}`);
    log.info(`Total locations: ${data.location.length}`);
    log.info(`Total mattresses: ${data.allMatresses.length}`);
    
    // Count total images
    let totalImages = 0;
    for (const mattress of data.allMatresses) {
      if (mattress.images) {
        totalImages += mattress.images.length;
      }
    }
    log.info(`Total images: ${totalImages}`);
    
  } catch (error) {
    log.error(`Error downloading data: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
main(); 