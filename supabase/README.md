# Pasbygger med database (Supabase)

Appen kan hente og gemme spillere, grupper, tilmeldte, kampe og kampsæt i en database i stedet for Google-arket.
Trænerne logger så ind med deres egen e-mail og en kode, der sendes til den. Træningsplan og øvelser kommer stadig
fra arket, men med samme login.

Så længe `SUPABASE` i `index.html` er tom, bruger appen arket som før.

- `schema.sql`: databasen – tabeller, adgangsregler og de funktioner, appen kalder.
- `import.js`: flytter et holds spillere og historik fra arket til databasen.
- Testene (`tests/supabase.test.js`) kører skemaet på en rigtig PostgreSQL og tjekker adgangsreglerne.

## Opsætning (ca. 30 minutter)

1. **Opret projektet.** Lav en gratis konto på [supabase.com](https://supabase.com) og et nyt projekt i regionen
   **Central EU (Frankfurt)**. Gem databasekoden et sikkert sted.
2. **Databasen.** Åbn *SQL Editor*, indsæt hele `schema.sql`, og tryk *Run*.
3. **Login.** Under *Authentication*:
   - *Sign In / Providers → Email*: slå *Email* til og **slå "Allow new users to sign up" fra**, så kun inviterede kan logge ind.
   - *Emails → Magic Link*: sæt skabelonen til at vise koden, fx
     `<h2>Din kode til Pasbygger</h2><p>{{ .Token }}</p>`.
   - Til rigtig brug: opsæt egen e-mailafsender (SMTP) under *Emails → SMTP Settings*; Supabases egen sender er
     begrænset til få e-mails i timen.
4. **Klub, hold og trænere.** Tilføj trænerne under *Authentication → Users → Add user* (kun e-mail). Kør derefter i
   *SQL Editor* (ret navne og e-mails):

   ```sql
   with c as (insert into clubs (name) values ('Min klub') returning id),
        t as (insert into teams (club_id, name) select id, 'U10' from c returning id)
   insert into team_members (team_id, user_id, role)
   select t.id, u.id, case u.email when 'holdleder@eksempel.dk' then 'admin' else 'coach' end::team_role
   from t, auth.users u where u.email in ('holdleder@eksempel.dk', 'traener@eksempel.dk');
   select id, name from teams;   -- holdets id, til importen
   ```

   Roller: `admin` (holdleder: alt, også at fjerne spillere), `coach` (træner) og `assistant` (hjælpetræner: ser
   spillerne uden niveauer og kan kun gemme tilmeldte).
5. **Flyt data fra arket.** På en computer med Node.js 20 eller nyere, i mappen med koden:

   ```
   node supabase/import.js --code <trænerkoden> --team <holdets id> > import.sql
   ```

   Indsæt `import.sql` i *SQL Editor* og kør den. Kan køres igen; den erstatter så holdets gemte træninger med arkets.
6. **Øvelser med samme login.** I Apps Script: *Project Settings → Script Properties*: tilføj `SUPABASE_URL`
   (*Project URL* fra Supabase → *Project Settings → API*) og `SUPABASE_KEY` (*anon / publishable key* samme sted).
   Kopiér den nye `Code.gs` ind, og vælg *Deploy → Manage deployments → Edit → New version*.
7. **Prøv på én telefon.** Åbn appen, og skriv i browserens konsol (eller bed om hjælp til det):

   ```js
   localStorage.setItem("oevSupabase", JSON.stringify({ url: "https://<projekt>.supabase.co", key: "<anon key>" }))
   ```

   Genindlæs. Grupper beder nu om e-mail og kode. Fjern igen med `localStorage.removeItem("oevSupabase")`.
8. **Skift for alle.** Sæt `url` og `key` ind i `const SUPABASE = { url: "", key: "" };` i `index.html`, og merge.
   Nøglen er offentlig af natur (den står i appen); det er adgangsreglerne i databasen, der beskytter data.

## Godt at vide

- **Hvem ser hvad** afgøres i databasen (row-level security), ikke i appen: en træner får kun sine egne holds rækker.
- **Niveauændringer** gemmes med tidspunkt og hvem (`player_levels`), så 25-50-25-historikken kan læses tilbage.
- **Sletning (GDPR):** `select forget_player('<holdets id>', 'Navn');` fjerner spilleren og navnet fra alle gemte
  træninger (kun holdleder).
- **Spillere** rettes indtil videre i *Table Editor → players* (navn, `lo` = Fra, `hi` = Til, `positions`, `active`).
  Adminsider i appen kommer i næste fase.
- **Backup:** Supabase tager daglig backup på betalte planer; på den gratis plan bør du selv eksportere jævnligt.
