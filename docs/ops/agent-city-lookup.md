# Agent approval city lookup

The device-code approval page can say “in CITY”. That city is optional. The server does not look it up unless the process environment sets `AGENT_CITY_LOOKUP`.

| Value | Behavior |
| --- | --- |
| unset, empty, `0`, `false`, or anything else | Off. No network call. The approval sentence omits the city. |
| `1`, `true`, or `on` (any case, surrounding space ignored) | On. A public requester IP is sent to ipdata.free. |

This flag is not in any env file in the repo. Artur sets it on the server when he wants the city line. Leave it unset until then.

When the flag is on, `backend/agent/cityLookup.js` sends `GET https://ipdata.free/{ip}` (keyless, 1.5s timeout). Private and loopback addresses are not sent. A miss, a timeout, or a thrown request leaves the city unset. Successful and missed lookups are cached for 10 minutes, and the cache keeps at most 1000 addresses. A city that contains a comma is flattened so the sentence stays “in CITY” with no comma.

ipdata.free allows commercial use with attribution ([ipdata.co/free](https://ipdata.co/free)). The approval page shows the credit only when a city is shown: “IP geolocation by ipdata”, linking to [https://ipdata.co/](https://ipdata.co/).
