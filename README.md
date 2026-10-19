# Desko CRM

Eenvoudig CRM voor Desko Kantoormeubelen. Werkt op telefoon en computer en is als app op het beginscherm te zetten.

- **Website:** GitHub Pages (map `site/`), wordt bij elke wijziging op `main` automatisch gepubliceerd.
- **Gegevens:** in de **privé** repository `Desko-Kantoorinrichting/desko-crm-data`, als JSON-bestanden in de map `data/`. Elke opslag is een commit, dus de geschiedenis van die repository is het wijzigingslog (wie, wat, wanneer).
- **Inloggen:** eenmalig per apparaat met een GitHub-toegangscode (fine-grained personal access token) die alleen bij `desko-crm-data` kan.
- **Nog niet gebouwd:** mail versturen via Microsoft 365, agenda, spraakmemo's, pushmeldingen. Mail versturen komt op één plek in `site/index.html` (zoek op `MAIL`).

## Eenmalig instellen

### 1. Repository voor de gegevens
1. Ga naar [github.com/new](https://github.com/new), owner **Desko-Kantoorinrichting**, naam `desko-crm-data`, kies **Private**. Vink niets aan en klik **Create repository**.
2. Geef iedereen die het CRM gebruikt (bijvoorbeeld Ferry) **Write**-toegang: in `desko-crm-data` → **Settings → Collaborators and teams → Add people**.

De bestanden worden automatisch aangemaakt bij de eerste keer opslaan.

### 2. Website publiceren
1. In deze repository (`desko-crm`): **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Actions → Website publiceren → Run workflow**. Na een minuut staat de site op `https://desko-kantoorinrichting.github.io/desko-crm/`.

### 3. Inloggen (per persoon, per apparaat)
1. Maak een gratis GitHub-account als je dat nog niet hebt, en accepteer de uitnodiging voor `desko-crm-data`.
2. Open [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new):
   - Naam: `Desko CRM`, vervaldatum zo lang als toegestaan
   - Resource owner: **Desko-Kantoorinrichting**
   - Repository access: **Only select repositories** → `desko-crm-data`
   - Repository permissions → **Contents: Read and write**
   - **Generate token** en kopieer de code
3. Open de website, plak de code en klik **Inloggen**. De code wordt alleen op dat apparaat bewaard.
4. Telefoon: kies daarna **Toevoegen aan beginscherm** (iPhone: deelknop in Safari; Android: menu in Chrome).

Werkt de code niet? Mogelijk moet een beheerder van de organisatie fine-grained tokens toestaan of goedkeuren: **Organization settings → Personal access tokens**.

### Eigen adres (crm.desko.nl)
1. Laat bij jullie domeinbeheer een DNS-record toevoegen: `CNAME crm → desko-kantoorinrichting.github.io`
2. Vul in GitHub bij **Settings → Pages → Custom domain** `crm.desko.nl` in en zet **Enforce HTTPS** aan.

## Goed om te weten
- **Privacy:** de gegevens staan nooit in deze (publieke) repository, alleen in de privé repository `desko-crm-data`.
- **Verwijderen (AVG):** een verwijderd bedrijf verdwijnt uit de app en de actuele bestanden, maar staat nog in de Git-geschiedenis van `desko-crm-data`. Moet iets echt helemaal weg, dan moet die geschiedenis worden opgeschoond.
- **Tegelijk werken:** schrijven twee mensen tegelijk, dan worden de wijzigingen samengevoegd. Andere apparaten zien wijzigingen binnen een minuut, of direct bij het openen van de app.

## Hoe het in elkaar zit

| Bestand | Wat |
|---|---|
| `site/index.html` | De hele app (schermen, opvolglogica, commissie, export) |
| `site/db.js` | Opslag in GitHub (lezen, schrijven, samenvoegen, verversen) |
| `site/config.js` | Welke repository de gegevens bevat |
| `.github/workflows/pages.yml` | Automatisch publiceren |
