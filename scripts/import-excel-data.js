import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// Parse .env.local manually to be dependency-free
const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  line = line.trim();
  if (line && !line.startsWith('#')) {
    const parts = line.split('=');
    const key = parts[0].trim();
    const value = parts.slice(1).join('=').trim();
    env[key] = value;
  }
});

const supabaseUrl = env['VITE_SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Load parsed JSON data
const parsedData = JSON.parse(fs.readFileSync('scripts/parsed-vendors-refined.json', 'utf8'));

async function main() {
  console.log('Starting vendor & contact import...');
  
  for (const [companyName, contacts] of Object.entries(parsedData)) {
    console.log(`Processing company: "${companyName}"...`);
    
    // 1. Check if vendor already exists
    let { data: existingVendor, error: findError } = await supabase
      .from('vendors')
      .select('id, vendor_name')
      .ilike('vendor_name', companyName)
      .maybeSingle();
      
    if (findError) {
      console.error(`Error finding vendor "${companyName}":`, findError);
      continue;
    }
    
    let vendorId;
    if (existingVendor) {
      vendorId = existingVendor.id;
      console.log(`  -> Vendor already exists. ID: ${vendorId}`);
    } else {
      // Create new vendor
      const { data: newVendor, error: insertError } = await supabase
        .from('vendors')
        .insert({
          vendor_name: companyName
        })
        .select('id')
        .single();
        
      if (insertError) {
        console.error(`  -> Error inserting vendor "${companyName}":`, insertError);
        continue;
      }
      vendorId = newVendor.id;
      console.log(`  -> Created new vendor. ID: ${vendorId}`);
    }
    
    // 2. Insert or update contacts
    for (const contact of contacts) {
      if (!contact.name) continue;
      
      let { data: existingContact, error: findContactError } = await supabase
        .from('vendor_contacts')
        .select('id, position')
        .eq('vendor_id', vendorId)
        .eq('contact_name', contact.name)
        .maybeSingle();
        
      if (findContactError) {
        console.error(`    -> Error finding contact "${contact.name}":`, findContactError);
        continue;
      }
      
      if (existingContact) {
        // Check if title needs update
        if (existingContact.position !== contact.title) {
          const { error: updateError } = await supabase
            .from('vendor_contacts')
            .update({ position: contact.title })
            .eq('id', existingContact.id);
            
          if (updateError) {
            console.error(`    -> Error updating position for "${contact.name}":`, updateError);
          } else {
            console.log(`    -> Updated contact "${contact.name}" position: "${existingContact.position}" -> "${contact.title}"`);
          }
        } else {
          console.log(`    -> Contact "${contact.name}" (${contact.title || 'no title'}) already exists.`);
        }
      } else {
        // Insert new contact
        const { error: insertContactError } = await supabase
          .from('vendor_contacts')
          .insert({
            vendor_id: vendorId,
            contact_name: contact.name,
            position: contact.title || '',
            contact_phone: '',
            contact_email: ''
          });
          
        if (insertContactError) {
          console.error(`    -> Error inserting contact "${contact.name}":`, insertContactError);
        } else {
          console.log(`    -> Created new contact: "${contact.name}" (${contact.title || 'no title'})`);
        }
      }
    }
  }
  
  console.log('Import completed successfully!');
}

main().catch(err => {
  console.error('Fatal error during import:', err);
  process.exit(1);
});
