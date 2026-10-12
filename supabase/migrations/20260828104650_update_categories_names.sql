-- 20260828104650_update_categories_names.sql
-- Update specific category names as requested.

UPDATE categories 
SET name = 'Socio cultural' 
WHERE slug = 'music';

UPDATE categories 
SET name = 'aQuSiS' 
WHERE slug = 'dance';

UPDATE categories 
SET name = 'Workshop' 
WHERE slug = 'drama';

UPDATE categories 
SET name = 'Scientific society' 
WHERE slug = 'medsci';
