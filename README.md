# Desko CRM

Eenvoudig CRM voor Desko Kantoormeubelen. Werkt op telefoon en computer en is als app op het beginscherm te zetten.

- **Website:** GitHub Pages (map `site/`), wordt bij elke wijziging op `main` automatisch gepubliceerd.
- **Database en inloggen:** Supabase (regio Frankfurt, EU). Inloggen gaat met een inloglink per e-mail.
- **Nog niet gebouwd:** mail versturen via Microsoft 365, agenda, spraakmemo's, pushmeldingen. Mail versturen komt op één plek in `site/index.html` (zoek op `MAIL`).

## Eenmalig instellen

### 1. Supabase

1. Maak een gratis account op [supabase.com](https://supabase.com) en een nieuw project `desko-crm`, regio **Central EU (Frankfurt)**.
2. Ga naar **SQL Editor → New query**, plak de inhoud van `supabase/schema.sql` en klik **Run**.
3. Ga naar **Authentication → Sign In / Providers**:
   - zet **Allow new users to sign up** **uit** (dan kan alleen wie jij toevoegt inloggen);
   - laat **Email** aan staan.
4. Ga naar **Authentication → URL Configuration**:
   - **Site URL:** het adres van de website, bijvoorbeeld `https://desko-kantoorinrichting.github.io/desko-crm/`
   - zet hetzelfde adres ook bij **Redirect URLs**.
5. Ga naar **Authentication → Users → Add user → Send invitation** en voeg de e-mailadressen toe van wie mag inloggen (bijvoorbeeld Ferry).
6. Kopieer bij **Project Settings → API** de **Project URL** en de **anon public** key. Deel nooit de *service_role* key.

### 2. GitHub

1. In deze repository: **Settings → Secrets and variables → Actions → tabblad Variables → New repository variable**:
   - `SUPABASE_URL` = de Project URL
   - `SUPABASE_ANON_KEY` = de anon public key
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Ga naar **Actions → Website publiceren → Run workflow**. Na een minuut staat de site online op het adres dat bij Pages staat.

### 3. Op de telefoon

Open de website, log in met de link uit de mail en kies **Toevoegen aan beginscherm** (iPhone: deelknop in Safari; Android: menu in Chrome).

### Eigen adres (crm.desko.nl)

1. Laat bij jullie domeinbeheer een DNS-record toevoegen: `CNAME crm → desko-kantoorinrichting.github.io`
2. Vul in GitHub bij **Settings → Pages → Custom domain** `crm.desko.nl` in en zet **Enforce HTTPS** aan.
3. Pas in Supabase de Site URL en Redirect URL aan naar `https://crm.desko.nl/`.

## Hoe het in elkaar zit

| Bestand | Wat |
|---|---|
| `site/index.html` | De hele app (schermen, opvolglogica, commissie, export) |
| `site/db.js` | Koppeling met Supabase |
| `site/config.js` | Supabase-adres en sleutel (wordt bij publiceren ingevuld) |
| `supabase/schema.sql` | Database, toegangsregels en wijzigingslog |
| `.github/workflows/pages.yml` | Automatisch publiceren |

Alle gegevens staan in de tabel `documenten` (per rij een bedrijf, activiteit, deal, enz. als JSON). Elke wijziging wordt met gebruiker en tijdstip vastgelegd in `wijzigingslog`.

Lokaal testen: vul `site/config.js` in en start `npx serve site`.
