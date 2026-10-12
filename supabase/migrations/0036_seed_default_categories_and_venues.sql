-- 0036_seed_default_categories_and_venues.sql
--
-- Seed default categories and common venues for the active festival.
--

insert into categories (festival_id, slug, name, tagline, icon_key, color_key, sort_order, is_active)
select 
  f.id,
  cat.slug,
  cat.name,
  cat.tagline,
  cat.icon_key,
  cat.color_key,
  cat.sort_order,
  true
from festivals f
cross join (values
  ('music', 'Socio cultural', 'Bands, vocals, acoustics & beats', 'music', 'accent', 1),
  ('dance', 'aQuSiS', 'Solo, duet, street & crew battles', 'activity', 'secondary', 2),
  ('drama', 'Workshop', 'Stage plays, street theatre & workshops', 'film', 'muted', 3),
  ('arts', 'Fine Arts', 'Painting, sketching, digital art & crafts', 'palette', 'white', 4),
  ('literary', 'Literary', 'Debate, quiz, poetry & creative writing', 'book-open', 'accent', 5),
  ('sports', 'Sports', 'Cricket, football, badminton, athletics & gaming', 'trophy', 'secondary', 6),
  ('medsci', 'Scientific society', 'Clinical skills, medical quiz & case presentations', 'cross', 'muted', 7),
  ('informal', 'Informals', 'Fun games, scavenger hunts & casual contests', 'sparkles', 'white', 8)
) as cat(slug, name, tagline, icon_key, color_key, sort_order)
on conflict (festival_id, slug) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  icon_key = excluded.icon_key,
  color_key = excluded.color_key,
  sort_order = excluded.sort_order,
  is_active = true;

-- Default common venues
insert into venues (festival_id, name, short_name, description, is_active)
select
  f.id,
  v.name,
  v.short_name,
  v.description,
  true
from festivals f
cross join (values
  ('Main Quadrangle Stage', 'Main Stage', 'Central open-air stage for flagship events and pronites'),
  ('JL Auditorium', 'JL Audi', 'Main indoor air-conditioned auditorium'),
  ('LT 1 (Lecture Theatre 1)', 'LT 1', 'Indoor tiered hall for quizzes and academic events'),
  ('LT 2 (Lecture Theatre 2)', 'LT 2', 'Indoor tiered hall for literary competitions'),
  ('Gymkhana Ground', 'Gymkhana', 'Outdoor sports complex and athletic field'),
  ('Swimming Pool Area / CR Desk', 'CR Desk', 'Central registration and help desk area')
) as v(name, short_name, description)
on conflict (festival_id, name) do nothing;

