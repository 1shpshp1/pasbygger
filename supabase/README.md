# Træningsparat med database (Supabase)

Appen kan hente og gemme alt i en database i stedet for Google-arket: spillere, grupper, tilmeldte, kampe, kampsæt,
hvert holds træningsplan, øvelsesbiblioteket og statistikken. Trænerne logger ind med deres egen e-mail og en kode,
der sendes til den. Google-arket og Apps Script bruges så slet ikke.

- **Træningsplaner** hører til hvert hold. Spillere og forældre ser holdets plan via holdets link
  (`…/pasbygger/?hold=<kode>`, koden står i `teams.plan_code`); en indlogget træner ser sit eget holds plan.
- **Øvelsesbiblioteket** har kilder (`drill_sources`). Kun DBU er slået til; FCK, FA, NFF og et eget bibliotek er
  forberedt, men slået fra. En klub kan have egne øvelser (`owner_club`), som kun den selv ser. Hele øvelsen vises i
  appen med kilden krediteret, som i dag.

Så længe `SUPABASE` i `index.html` er tom, bruger appen arket som før.

- `schema.sql`: databasen – tabeller, adgangsregler og de funktioner, appen kalder.
- `import.js`: flytter et holds spillere, historik og træningsplan og DBU-øvelserne fra arket til databasen.
- Testene (`tests/supabase.test.js`) kører skemaet på en rigtig PostgreSQL og tjekker adgangsreglerne.

## Opsætning (ca. 30 minutter)

1. **Opret projektet.** Lav en gratis konto på [supabase.com](https://supabase.com) og et nyt projekt i regionen
   **Central EU (Frankfurt)**. Gem databasekoden et sikkert sted.
2. **Databasen.** Åbn *SQL Editor*, indsæt hele `schema.sql`, og tryk *Run*.
3. **Login.** Under *Authentication → Sign In / Providers*: slå *Email* til og **slå "Allow new users to sign up" fra**,
   så kun dem, du opretter, kan logge ind. Trænerne logger ind med e-mail og en adgangskode, du giver dem
   (`login: "password"`, standard); der sendes ingen e-mails.
   - Vil du hellere have en kode sendt på e-mail (`login: "code"` i `SUPABASE`), kræver det en egen e-mailafsender
     (*Emails → SMTP Settings*), og skabelonen *Magic link* skal vise koden: `<p>Din kode: {{ .Token }}</p>`.
4. **Klub, hold og trænere.** Opret hver træner under *Authentication → Users → Add user → Create new user* med
   e-mail, en adgangskode og **Auto Confirm User** slået til. Kør derefter i *SQL Editor* (ret navne; kan køres igen):

   ```sql
   insert into clubs (name) select 'Min klub' where not exists (select 1 from clubs where name = 'Min klub');
   insert into teams (club_id, name) select c.id, 'U10' from clubs c
     where c.name = 'Min klub' and not exists (select 1 from teams t where t.club_id = c.id and t.name = 'U10');
   insert into team_members (team_id, user_id, role)
     select t.id, u.id, case when u.email = 'admin@eksempel.dk' then 'admin' else 'coach' end::team_role
     from teams t, auth.users u where t.name = 'U10' and u.email in ('admin@eksempel.dk', 'traener@eksempel.dk')
     on conflict (team_id, user_id) do nothing;
   select id as hold_id, plan_code as holdkode from teams where name = 'U10';
   ```

   Roller: `admin` (Admin: alt, også spillere, niveauer og trænere), `coach` (træner) og `assistant` (hjælpetræner: ser
   spillerne uden niveauer og kan kun gemme tilmeldte).
5. **Flyt data fra arket.** På en computer med Node.js 20 eller nyere, i mappen med koden:

   ```
   node supabase/import.js --code <trænerkoden> --team <holdets id> > import.sql
   ```

   Indsæt `import.sql` i *SQL Editor* og kør den. Den flytter spillere, gemte grupper og kampe, træningsplanen og
   øvelserne fra DBU (øvelser fra andre kilder springes over). Kan køres igen; den erstatter så holdets gemte
   træninger og plan med arkets.
6. **Dig som redaktør af det fælles bibliotek.** Kør `insert into app_admins select id from auth.users where email = '<din e-mail>';`
7. **Prøv på én telefon.** Åbn appen, og skriv i browserens konsol (eller bed om hjælp til det):

   ```js
   localStorage.setItem("oevSupabase", JSON.stringify({ url: "https://<projekt>.supabase.co", key: "<anon key>" }))
   ```

   Åbn derefter holdets link (`…/pasbygger/?hold=<kode>`). Grupper og Øvelser beder nu om e-mail og kode. Fjern igen
   med `localStorage.removeItem("oevSupabase")`.
8. **Skift for alle.** Sæt `url` og `key` ind i `const SUPABASE = { url: "", key: "", plan: "" };` i `index.html`
   (`plan`: holdkoden for den plan, besøgende uden link ser), og merge. Del holdets link med spillere og forældre.
   Nøglen er offentlig af natur (den står i appen); det er adgangsreglerne i databasen, der beskytter data.

## Godt at vide

- **Hvem ser hvad** afgøres i databasen (row-level security), ikke i appen: en træner får kun sine egne holds rækker.
- **Niveauændringer** gemmes med tidspunkt og hvem (`player_levels`), så 25-50-25-historikken kan læses tilbage.
- **Sletning (GDPR):** `select forget_player('<holdets id>', 'Navn');` fjerner spilleren og navnet fra alle gemte
  træninger (kun admin).
- **Spillere** rettes indtil videre i *Table Editor → players* (navn, `lo` = Fra, `hi` = Til, `positions`, `active`),
  indtil der kommer adminsider i appen. **Træningsplanen** skrives i appen: *+ Ny træning* over listen, og *Ret
  træningen* / *Kopiér til ny træning* i en åben træning (admins og trænere).
- **Statistik** står i `usage_counts` (antal pr. dag, intet om hvem).
- **Backup:** Supabase tager daglig backup på betalte planer; på den gratis plan bør du selv eksportere jævnligt.

## Admin-fanen

Holdets admins har fanen **Admin** i appen:

- **Spillere:** opret, ret navn, Fra/Til og favoritpladser, sæt en spiller som ikke aktiv, eller slet spilleren og al
  historik (GDPR). Et nyt navn rettes også i alle gemte grupper og kampe, så 25-50-25-historikken følger med.
  Kun admins kan ændre spillere og niveauer.
- **Trænere:** se holdets trænere, skift rolle (Admin, Træner, Hjælpetræner) og fjern. Et hold har altid mindst én admin.
- **Invitationer:** *Lav invitationslink* giver et link (`…/traeningsparat/?invite=KODE`), der kan bruges én gang og
  virker i 14 dage. Træneren åbner det og logger ind, eller opretter en bruger med e-mail og adgangskode.
  Det kræver i Supabase under *Authentication → Sign In / Providers*: **"Allow new users to sign up" slået til** og
  **"Confirm email" slået fra**. En bruger uden invitation kan oprette sig, men ser intet (adgangen gives kun af
  databasen, når en invitation bruges).

## Slettede træninger

En slettet træning gemmes i 90 dage og kan gendannes under *Slettede træninger* nederst i Træninger.

## Eget øvelsesbibliotek (klar, ikke slået til)

- Kilden `egne` i `drill_sources` er oprettet, men slået fra. Egne øvelser gemmes med `save_drill` – i det fælles
  bibliotek (af redaktører i `app_admins`) eller som en klubs egne (af klubbens administratorer).
- `drills.media` rummer tegninger og animationer (formatet står i `schema.sql`), og lageret **drill-media** i Supabase
  Storage rummer billederne (alle kan se dem; redaktører og klubadministratorer kan lægge dem op).
- Når biblioteket er klar: `update drill_sources set active = true where id = 'egne';`

## Opdatering af databasen

Når `schema.sql` ændres, kopieres hele filen ind i *SQL Editor* igen og køres. Den kan køres igen og igen uden at
miste data.
