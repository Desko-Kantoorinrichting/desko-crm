# Desko CRM

Eenvoudig CRM voor Desko Kantoormeubelen. Werkt op telefoon en computer en is als app op het beginscherm te zetten.

- **Website:** GitHub Pages (map `site/`), wordt bij elke wijziging op `main` automatisch gepubliceerd.
- **Gegevens:** in de **privé** repository `Desko-Kantoorinrichting/desko-crm-data`, als JSON-bestanden in de map `data/`. Elke opslag is een commit, dus de geschiedenis van die repository is het wijzigingslog (wie, wat, wanneer).
- **Inloggen:** met e-mail en wachtwoord via één gedeelde link. `site/gebruikers.json` bevat per gebruiker de GitHub-sleutel, versleuteld met diens wachtwoord; het e-mailadres staat er alleen als hash in.
- **Mail:** opvolgmails per mailreeks. De # van een prospect (bijv. `deuren intrappen` of `netwerk`) bepaalt de reeks. Mails worden ingepland en zijn tot het verzendmoment te bekijken, aan te passen of te annuleren. De **mailrobot** (GitHub Actions) verstuurt ze vanuit Microsoft 365 zodra die gekoppeld is; tot dan open je ze met één klik in je mailprogramma. Verstuurde en ontvangen mails zijn ook handmatig vast te leggen en te corrigeren.
- **Extra:** afspraken als agenda-bestand (.ics) in je eigen agenda zetten, waarschuwing bij dubbele bedrijven, meerdere bedrijven tegelijk bewerken, lijst "Al lang niets van gehoord", **Cijfers** (grafieken en export naar Excel), **In de buurt** (bedrijven op afstand vanaf je locatie, met route) met **Dagroute** (stops aanvinken, één route in Google Maps, na elk bezoek direct uitkomst en opvolging vastleggen; de route staat alleen op het eigen toestel) en **Kaartje scannen** (tekst van een visitekaartje lezen op het toestel zelf).
- **Externe diensten:** voor *In de buurt* worden alleen bedrijfsadressen omgezet naar coördinaten via de PDOK Locatieserver (Rijksoverheid). Het lezen van visitekaartjes gebeurt op het toestel; alleen de leessoftware (Tesseract) wordt van jsdelivr geladen, de foto gaat nergens heen.
- **Agenda:** per week of maand wie wanneer gebeld, gemaild of bezocht moet worden; ook als agenda-bestand voor Outlook.
- **Meldingen op de telefoon:** herinneringen als "Neem vandaag contact op met ...", met een link naar het profiel (zie stap 6).
- **Nog niet gebouwd:** directe koppeling met de Outlook-agenda, spraakmemo's.

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

### 5. Automatisch mailen (mailrobot)
1. Laat de IT-partij de app-registratie maken volgens `docs/IT-instructie-microsoft365.md` in de privé repository `desko-crm-data`.
2. Zet in deze repository bij **Settings → Secrets and variables → Actions → Secrets** (niet Variables):
   - `DATA_TOKEN`: een GitHub-sleutel met *Contents: Read and write* op `desko-crm-data`
   - `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`: van de IT-partij
   - `MS_AFZENDER`: het e-mailadres van de mailbox waaruit verstuurd wordt
3. **Actions → Mailrobot → Run workflow** om te testen. Daarna draait hij vanzelf elk kwartier op werkdagen. In de app staat onder **Mail** dan "Automatisch versturen staat aan".

De robot verstuurt alleen op werkdagen binnen kantoortijd, controleert vlak voor verzending of er al contact of een antwoord is geweest, en schrijft in het (openbare) Actions-logboek alleen aantallen, nooit namen of adressen. Mailteksten en reeksen staan in de privé repository, niet in deze code.

### 6. Meldingen op de telefoon (herinneringen)
1. Zet in deze repository bij **Settings → Secrets and variables → Actions → Secrets** het secret `DATA_TOKEN`: een GitHub-sleutel met *Contents: Read and write* op `desko-crm-data` (dezelfde als bij stap 5; één keer instellen is genoeg).
2. **Actions → Herinneringen → Run workflow** om te testen. Daarna draait hij vanzelf elk kwartier op werkdagen.
3. Iedereen die meldingen wil: in de app **Meer → Meldingen aanzetten** (of de knop op Vandaag). Op een iPhone eerst de app op het beginscherm zetten en vanaf daar openen.

Een opvolging van vandaag geeft een melding aan het begin van de werkdag, of om de gekozen tijd. Te late opvolgingen komen één keer per dag als samenvatting. De meldingen gaan versleuteld via de pushdienst van de telefoon (Google of Apple), die de inhoud niet kan lezen. De sleutel daarvoor staat in `data/push-sleutel.json` in de privé repository.

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
| `site/reeks.js` | Gedeelde logica: werkdagen, mailreeksen, inplannen (app en mailrobot) |
| `scripts/mailrobot.mjs` | Mailrobot: verstuurt ingeplande mails, herkent antwoorden |
| `scripts/herinneringen.mjs` | Meldingen op de telefoon voor opvolgingen |
| `tests/` | Tests voor de mailrobot en herinneringen: `node --test tests/*.mjs` |
| `.github/workflows/pages.yml` | Automatisch publiceren |
| `.github/workflows/mailrobot.yml` | Mailrobot elk kwartier op werkdagen |
| `.github/workflows/herinneringen.yml` | Herinneringen elk kwartier op werkdagen |
