import type { Opening } from './web.service';

/** Used when the database is unreachable or not configured. */
export const FALLBACK_OPENINGS: Opening[] = [
  { title: 'AI / ML Engineer', team: 'Intelligence', location: 'Remote or Kolkata', commitment: 'Internship', duration: '1 to 2 months', stipend_min: 3000, stipend_max: 4500, summary: 'Crop and moisture models over Sentinel imagery.' },
  { title: 'Backend Engineer', team: 'Platform', location: 'Remote', commitment: 'Internship', duration: '1 to 2 months', stipend_min: 2500, stipend_max: 4000, summary: 'Ingest pipelines and the APIs that serve them.' },
  { title: 'Frontend Engineer', team: 'Product', location: 'Remote', commitment: 'Internship', duration: '1 to 2 months', stipend_min: 2500, stipend_max: 4000, summary: 'The interfaces farmers and institutions actually use.' },
  { title: 'Product Engineer', team: 'Product', location: 'Remote or Kolkata', commitment: 'Internship', duration: '1 to 2 months', stipend_min: 2500, stipend_max: 4000, summary: 'End to end features, from the field problem to the shipped screen.' },
  { title: 'Geospatial Analyst', team: 'Intelligence', location: 'Kolkata', commitment: 'Internship', duration: '1 to 2 months', stipend_min: 2000, stipend_max: 3500, summary: 'Remote sensing, GIS layers and ground truth.' },
  { title: 'Marketing and Growth', team: 'Growth', location: 'Remote', commitment: 'Internship', duration: '1 to 2 months', stipend_min: 1500, stipend_max: 3000, summary: 'Reaching farmers in the languages and places they already are.' },
  { title: 'Design', team: 'Product', location: 'Remote', commitment: 'Internship', duration: '1 to 2 months', stipend_min: 2000, stipend_max: 3500, summary: 'Interfaces that work on a cheap phone in bright sunlight.' },
  { title: 'Field Operations', team: 'Field', location: 'Kolkata or field', commitment: 'Internship', duration: '1 to 2 months', stipend_min: 1500, stipend_max: 3000, summary: 'Time on real farms, turning what you see into product decisions.' },
];
