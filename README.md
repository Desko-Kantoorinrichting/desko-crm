# Desko CRM

Eenvoudig CRM voor Desko Kantoormeubelen. Werkt op telefoon en computer en is als app op het beginscherm te zetten.

- **Website:** GitHub Pages (map `site/`), wordt bij elke wijziging op `main` automatisch gepubliceerd.
- **Gegevens:** in de **privé** repository `Desko-Kantoorinrichting/desko-crm-data`, als JSON-bestanden in de map `data/`. Elke opslag is een commit, dus de geschiedenis van die repository is het wijzigingslog (wie, wat, wanneer).
- **Inloggen:** met e-mail en wachtwoord via één gedeelde link. `site/gebruikers.json` bevat per gebruiker de GitHub-sleutel, versleuteld met diens wachtwoord; het e-mailadres staat er alleen als hash in.
- **Nog niet gebouwd:** mail versturen via Microsoft 365, agenda, spraakmemo's, pushmeldingen. Mail versturen komt op één plek in `site/index.html` (zoek op `MAIL`).

## Eenmalig instellen

### 1. Repository voor de gegevens
1. Ga naar [github.com/new](https://github.com/new), owner **Desko-Kantoorinrichting**, naam `desko-crm-data`, kies **Private**. Vink niets aan en klik **Create repository**. Gebruikers van het CRM hebben geen GitHub-account nodig.
De bestanden worden automatisch aangemaakt bij de eerste keer opslaan.

### 2. Website publiceren
1. In deze repository (`desko-crm`): **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Actions → Website publiceren → Run workflow**. Na een minuut staat de site op `https://desko-kantoorinrichting.github.io/desko-crm/`.

### 3. Eerste beheerder (eenmalig)
1. Maak een GitHub-sleutel: [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - Naam `Desko CRM`, vervaldatum zo lang als toegestaan, resource owner **Desko-Kantoorinrichting**
   - **Only select repositories:** `desko-crm-data` én `desko-crm`
   - Repository permissions → **Contents: Read and write**
2. Open de website. Omdat er nog geen gebruikers zijn, verschijnt **Eerste keer instellen**. Vul je naam, e-mail, een wachtwoord en de sleutel in.

### 4. Gebruikers toevoegen
In de app: **Meer → Gebruikers**. Vul naam, e-mail en een wachtwoord in. Na ongeveer een minuut kan diegene inloggen via de gewone link. Hetzelfde formulier met een bestaand e-mailadres stelt een nieuw wachtwoord in. **Toegang intrekken** haalt iemand eruit; hij of zij wordt bij de volgende keer openen uitgelogd.

Wil je zeker weten dat een vertrokken collega er nooit meer bij kan, maak dan een nieuwe sleutel, trek de oude in op GitHub, maak `site/gebruikers.json` leeg (`{"gebruikers": []}`) en stel opnieuw in.

Telefoon: open de link en kies **Toevoegen aan beginscherm** (iPhone: deelknop in Safari; Android: menu in Chrome).

Werkt de sleutel niet? Mogelijk moet een beheerder van de organisatie fine-grained tokens toestaan: **Organization settings → Personal access tokens**.

### Eigen adres (crm.desko.nl)
1. Laat bij jullie domeinbeheer een DNS-record toevoegen: `CNAME crm → desko-kantoorinrichting.github.io`
2. Vul in GitHub bij **Settings → Pages → Custom domain** `crm.desko.nl` in en zet **Enforce HTTPS** aan.

## Goed om te weten
- **Privacy:** de gegevens staan nooit in deze (publieke) repository, alleen in de privé repository `desko-crm-data`.
- **Wachtwoorden:** gebruik minimaal 10 tekens, liefst een paar losse woorden. `gebruikers.json` is openbaar, dus een kort wachtwoord is te raden.
- **Verwijderen (AVG):** een verwijderd bedrijf verdwijnt uit de app en de actuele bestanden, maar staat nog in de Git-geschiedenis van `desko-crm-data`. Moet iets echt helemaal weg, dan moet die geschiedenis worden opgeschoond.
- **Tegelijk werken:** schrijven twee mensen tegelijk, dan worden de wijzigingen samengevoegd. Andere apparaten zien wijzigingen binnen een minuut, of direct bij het openen van de app.

## Hoe het in elkaar zit

| Bestand | Wat |
|---|---|
| `site/index.html` | De hele app (schermen, opvolglogica, commissie, export) |
| `site/db.js` | Opslag in GitHub (lezen, schrijven, samenvoegen, verversen) |
| `site/auth.js` | Inloggen met e-mail en wachtwoord (versleuteling) |
| `site/gebruikers.json` | Gebruikers met hun versleutelde sleutel |
| `site/config.js` | Welke repositories worden gebruikt |
| `.github/workflows/pages.yml` | Automatisch publiceren |
