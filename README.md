# Banda: chat e chiamate tra amici

Nessun account: chi apre il link sceglie un nome ed entra.
Ha canali di testo (generale, giochi, musica) e una stanza vocale.

## Provarla sul tuo computer
1. Installa Node.js (versione 18 o più recente).
2. Nella cartella del progetto: `npm install` e poi `npm start`
3. Apri http://localhost:3000

## Metterla online (gratis, con Render)
1. Crea un repository su GitHub e caricaci questi file.
2. Su render.com: New > Web Service > collega il repository.
3. Build command: `npm install` — Start command: `npm start`
4. Quando è pronto, Render ti dà un link https: mandalo agli amici.

Il microfono funziona solo su HTTPS (o su localhost): Render lo fornisce.

## Password della stanza (consigliata)
Imposta la variabile d'ambiente `ROOM_PASSWORD` (su Render: Environment).
Solo chi la conosce potrà entrare.

## Cose da sapere
- I messaggi sono salvati in `messages.json` (gli ultimi 200 per canale).
  Sul piano gratuito di Render il disco si azzera a ogni riavvio, quindi la cronologia può sparire.
- Le chiamate sono dirette tra i partecipanti (WebRTC) e vanno bene per piccoli gruppi, circa 5-6 persone.
- Con alcune reti (alcuni Wi-Fi aziendali o dati mobili) la voce può non collegarsi: servirebbe un server TURN.
