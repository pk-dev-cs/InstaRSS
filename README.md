# InstaRSS

MVP, które tworzy kanał RSS z publicznych postów profilu w serwisie ze zdjęciami. Wpisy zawierają opis, link do posta i zdjęcia pod adresem aplikacji. Posty i obrazy są dostępne przez 30 dni od publikacji.

## Uruchomienie

Wymagany Node.js 20+ oraz trwały katalog na dane i zdjęcia.

```bash
npm install
cp .env.example .env.local
npm run dev
```

W PowerShell skopiuj plik konfiguracji przez `Copy-Item .env.example .env.local`. Wejdź na `http://localhost:3000` i dodaj nazwę profilu. Następnie uruchom:

```bash
npm run sync
```

Kanał: `http://localhost:3000/rss/nazwa_profilu.xml`.

Możesz też nacisnąć „Aktualizuj” przy profilu. W produkcji uruchamiaj `npm run sync` z harmonogramu systemowego, np. co godzinę. Zadanie usuwa wpisy starsze niż 30 dni przed pobieraniem nowych. `npm run cleanup` pozwala uruchomić samo czyszczenie. Ustaw `APP_BASE_URL` na publiczny adres aplikacji i `DATA_DIR` na trwały lokalny dysk. SQLite WAL wymaga, by wszystkie procesy korzystały z tego samego hosta.

## Synchronizacja przez cron na Railway

Ustaw w serwisie aplikacji `SYNC_TOKEN` na długi losowy sekret. Endpoint `POST /api/sync` uruchamia czyszczenie oraz pobieranie wszystkich profili. Jest chroniony tokenem Bearer, niezależnie od hasła administratora. Bez `SYNC_TOKEN` endpoint jest wyłączony. Równoległe wywołanie zwraca HTTP 409, a niepowodzenie pobierania HTTP 502.

W osobnym serwisie cron ustaw ten sam sekret jako zmienną `SYNC_TOKEN`, adres aplikacji jako `APP_BASE_URL` i komendę startową:

```bash
curl --fail-with-body --request POST --header "Authorization: Bearer $SYNC_TOKEN" "$APP_BASE_URL/api/sync"
```

Obraz serwisu cron musi zawierać `curl`. Przykładowy harmonogram co godzinę: `0 * * * *`. Cron czeka na zakończenie żądania, więc jego limit czasu musi uwzględniać pobranie wszystkich profili. Baza i zdjęcia pozostają na wolumenie serwisu aplikacji; cron jedynie wysyła żądanie HTTP.

## Źródła danych

Jeśli ustawisz `META_ACCESS_TOKEN` oraz `META_IG_USER_ID`, aplikacja najpierw użyje Meta Business Discovery. Konto powiązane z tokenem musi mieć wymagane uprawnienia. Bez tej konfiguracji lub gdy API zwróci błąd, aplikacja próbuje odczytać publiczny HTML profilu i wpisów. Jeśli HTML nie zawiera postów, używa Playwright do odczytu publicznej strony po wyrenderowaniu w przeglądarce. Przed uruchomieniem pobierz przeglądarkę przez `npx playwright install chromium`. Dostęp do publicznej strony może zostać ograniczony przez serwis źródłowy. Aplikacja nie używa sesji użytkownika ani mechanizmów omijania blokad.

Przed publicznym wdrożeniem ustaw `ADMIN_PASSWORD`. Panel i akcje dodawania oraz aktualizacji profili będą wtedy chronione HTTP Basic Auth (użytkownik: `admin`). Kanały RSS i zdjęcia pozostają publiczne.
