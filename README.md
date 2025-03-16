# Horizontal Mattress Airtable Download

This script downloads mattress records from an Airtable base, including related photographers, locations, and images. It's designed with rate limiting to avoid hitting Airtable's API limits.

## Setup

1. Make sure you have Node.js installed (version 14 or higher recommended)
2. Install dependencies:
   ```
   npm install
   ```
3. Ensure your `.env` file contains the following variables:
   ```
   BASE_ID=your_airtable_base_id
   BASE_API_KEY=your_airtable_api_key
   ```

## Running the Script

To download data from Airtable:

```
npm start
```

Or run directly:

```
node download.js
```

## Resume Functionality

The script includes smart resume functionality:

- If the script is interrupted and restarted, it will:
  - Use existing JSON data files if they exist instead of re-downloading them
  - Check for existing images and only download missing ones
  - Compare file sizes to avoid re-downloading identical images

This makes the script resilient to interruptions and efficient when run multiple times.

## Configuration

The script is configured to download ALL data by default:

```javascript
// Default configuration - downloads ALL records
const CONFIG = {
  // Number of records to fetch from each table
  SAMPLE_SIZE: {
    [TABLES.MATTRESSES]: null,     // null means fetch all
    [TABLES.PHOTOGRAPHER]: null,    // null means fetch all
    [TABLES.LOCATION]: null         // null means fetch all
  },
  // Delay between API requests in milliseconds
  API_DELAY: 1000                   // Adjust this to control request rate
};
```

### Downloading a Limited Number of Mattresses

If you want to download only a limited number of mattresses (for example, for development or testing), you can change the `SAMPLE_SIZE` for mattresses:

```javascript
// Sample configuration - downloads only 20 mattresses
const CONFIG = {
  // Number of records to fetch from each table
  SAMPLE_SIZE: {
    [TABLES.MATTRESSES]: 20,       // Download only 20 mattresses
    [TABLES.PHOTOGRAPHER]: null,    // Download all photographers
    [TABLES.LOCATION]: null         // Download all locations
  },
  // Delay between API requests in milliseconds
  API_DELAY: 1000                   // Adjust this to control request rate
};
```

This will download only 20 mattress records with their associated images, which is much faster than downloading the entire dataset.

## Output Structure

The script creates the following directory structure:

```
data/                              // Output directory
├── images/
│   └── [record_id]/               // Each mattress has its own folder
│       └── 1.jpg                  // Images are numbered sequentially
├── tables/
│   ├── allMatresses.json          // All mattress records
│   ├── photographer.json          // All photographers
│   └── location.json              // All locations
└── mattresses-data.json           // Combined data from all tables
```

## Data Format

The final `mattresses-data.json` file contains:

```json
{
  "allMatresses": [...],           // All mattress records
  "photographer": [...],           // All photographers
  "location": [...]                // All locations
}
```

Each mattress record includes:
- ID
- Date
- Photographers (with names and details)
- Location (with name and details)
- Images (with paths to local files)

## Utility Scripts

The project includes several utility scripts for debugging:

- `debug-tables.js`: Shows the structure of tables in Airtable
- `debug-images.js`: Helps debug image fields in Airtable
- `check-tables.js`: Verifies Airtable API access and lists available tables

## Troubleshooting

- The script includes built-in rate limiting and will automatically retry if it hits Airtable's rate limits
- For large image collections, the download may take some time (potentially hours for the full dataset)
- Check the console output for progress updates and any error messages 