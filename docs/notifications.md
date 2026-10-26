# Pop-ups on the TV

Anything on the home network can put a pop-up on the TV, over whatever is on: the doorbell
showing who's at the door, a meeting about to start, an alarm. A pop-up is any mix of a **title**,
**text**, a **picture** and a **video**, wherever you want it on the screen, for as long as you
want. Send one from the phone remote (**Pop-up** at the bottom) or from Home Assistant, a script or
anything that can make a web request to the Hub.

![A doorbell pop-up](screenshots/45-notice-doorbell.png)
![Pop-ups in the corners](screenshots/46-notice-corners.png)

Pop-ups in the middle or full screen, alarms, and ones that stay until closed take the remote's
**OK** and **Back**: either closes the newest one. Small ones in a corner leave the remote alone and
go by themselves, with a thin line along the bottom running down the time left.

Only paired phones and things holding the Hub's **API key** can send pop-ups (see
[Pairing](pairing.md)). Find the key on the phone's settings page under **Phones** (or on the TV,
Settings › Phones and remotes › Home Assistant key) and send it with every request as the header
`X-Api-Key: utv_…` (or `Authorization: Bearer utv_…`). The key can send pop-ups, news flashes and
key presses, and nothing else. Still keep the Hub on the home network: don't forward port 8095 on
the router.

## From the phone

Tap **Pop-up** at the bottom of the remote. Choose what it is (Message, Doorbell, Meeting, Alarm,
Warning), write a title and a message, add a photo or video from the phone if you like, tap where
on the TV it goes, its size, how long it stays and its sound. **Pause what's playing** pauses the
film while it shows and carries on when it goes. Pop-ups on the TV now are listed underneath, each
with **Take down**.

![Sending a pop-up from the phone](screenshots/47-phone-popup.png)

## The API

`POST http://192.168.0.19:8095/api/notify` with a JSON body and the `X-Api-Key` header. Everything is optional except that
there must be at least one of `title`, `text`, `image` or `video`.

| Field | What it does | Default |
| --- | --- | --- |
| `title` | Big text at the top (up to 120 characters) | |
| `text` (or `message`) | The message under it (up to 1000 characters; new lines are kept) | |
| `image` | A picture: a web address (`http://…`) or a `data:image/jpeg;base64,…` address. The Hub fetches a web picture **at once** and keeps its own copy, so the TV shows the moment the bell rang and doesn't need to reach the camera | |
| `headers` | Headers for the Hub's fetch of `image`, such as `{"Authorization": "Bearer …"}` | |
| `video` | A video the TV plays on a loop: a web address (MP4 or WebM; the TV plays it from there) or a `data:` address | |
| `muted` | `true` plays the video without sound | `false` |
| `kind` | `info`, `doorbell`, `meeting`, `alarm` or `warning`: the icon, the colour and the defaults below | `info` |
| `position` | `center`, `top`, `bottom`, `top-left`, `top-right`, `bottom-left`, `bottom-right` or `full` (the whole screen) | by kind |
| `size` | `small`, `medium` or `large` | by kind |
| `seconds` | How long it stays; `0` stays until closed with OK or Back (or taken down) | by kind |
| `sound` | `none`, `ping`, `chime` (ding-dong) or `alarm` (beeps again and again until closed) | by kind |
| `pause` | `true` pauses what's playing while it shows | `false` |
| `wake` | `true` turns the TV on (HDMI-CEC, once the Pulse-Eight adapter is in) | `true` for alarms |
| `id` | Your own name for it (letters, numbers, `.`, `-`, `_`). Sending the same id again replaces the old one, so a second ring doesn't stack up | made up |

What each kind starts with:

| Kind | Position | Size | Seconds | Sound |
| --- | --- | --- | --- | --- |
| `info` | bottom right | medium | 15 | ping |
| `doorbell` | center | large | 30 | chime |
| `meeting` | top right | medium | 60 | chime |
| `warning` | top | medium | 30 | chime |
| `alarm` | center | large | until closed | alarm |

The answer is the pop-up as the TV got it, with `warnings` when something was off (say the Hub
couldn't fetch the picture, in which case the TV tries the address itself):

```json
{ "notice": { "id": "doorbell", "kind": "doorbell", "title": "Someone's at the front door", "image": "/api/notify/media/…", "position": "center", "size": "large", "sound": "chime", "until": 1761417727000, "leftMs": 30000, "…": "…" } }
```

### A picture or video as the request body

Send the picture (JPEG, PNG, GIF, WebP) or video (MP4, WebM, MOV) itself as the body, with the
other fields in the address. Handy from a script that has just saved a snapshot:

```sh
curl -X POST "http://192.168.0.19:8095/api/notify?kind=doorbell&title=Front%20door&position=bottom-right" \
  -H "X-Api-Key: $UTV_KEY" -H "Content-Type: image/jpeg" --data-binary @snapshot.jpg
```

Or upload it first with `POST /api/notify/media` (the file as the body), which answers
`{"url": "/api/notify/media/…", "kind": "image"}`, and put that `url` in `image` or `video`.
Uploads can be up to 200 MB. The Hub keeps the last 30 and forgets them when it restarts.

### Other calls

- `GET /api/notify`: the pop-ups showing now.
- `DELETE /api/notify/<id>`: takes one down (from the TV too).
- `DELETE /api/notify`: takes them all down.

### Examples

```sh
# The key from the phone's settings page (Phones › Show the key)
UTV_KEY=utv_…

# A message in the corner for 10 seconds
curl -X POST http://192.168.0.19:8095/api/notify -H "X-Api-Key: $UTV_KEY" -H "Content-Type: application/json" \
  -d '{"title": "Dinner is ready", "seconds": 10}'

# A meeting, top right, without a sound
curl -X POST http://192.168.0.19:8095/api/notify -H "X-Api-Key: $UTV_KEY" -H "Content-Type: application/json" \
  -d '{"kind": "meeting", "title": "Team call in 5 minutes", "text": "Weekly planning", "sound": "none"}'

# An alarm that pauses the film and beeps until someone presses OK
curl -X POST http://192.168.0.19:8095/api/notify -H "X-Api-Key: $UTV_KEY" -H "Content-Type: application/json" \
  -d '{"id": "alarm", "kind": "alarm", "title": "Time to leave for school", "pause": true}'

# Take the alarm down from somewhere else
curl -X DELETE http://192.168.0.19:8095/api/notify/alarm -H "X-Api-Key: $UTV_KEY"
```

## Home Assistant

Put the Hub's API key in `secrets.yaml` (`tv_api_key: utv_…`), add one REST command to
`configuration.yaml` that sends whatever it's given, and restart Home Assistant:

```yaml
rest_command:
  tv_notify:
    url: http://192.168.0.19:8095/api/notify
    method: post
    content_type: application/json
    headers:
      X-Api-Key: !secret tv_api_key
    payload: "{{ notice | to_json }}"
```

Then an automation for the doorbell. The camera's `entity_picture` carries its own access token,
so the Hub can fetch the snapshot without a Home Assistant login; change the Home Assistant address,
the doorbell's entity and the camera's to yours:

```yaml
automation:
  - alias: Doorbell on the TV
    triggers:
      - trigger: state
        entity_id: binary_sensor.front_door_doorbell
        to: "on"
    actions:
      - action: rest_command.tv_notify
        data:
          notice:
            id: doorbell
            kind: doorbell
            title: Someone's at the front door
            image: "http://homeassistant.local:8123{{ state_attr('camera.front_door', 'entity_picture') }}"
            pause: true
```

Or with a long-lived access token (your profile in Home Assistant › Security) instead:

```yaml
            image: http://homeassistant.local:8123/api/camera_proxy/camera.front_door
            headers:
              Authorization: !secret tv_camera_auth   # "Bearer <token>" in secrets.yaml
```

A meeting from the calendar, ten minutes before it starts:

```yaml
  - alias: Meeting on the TV
    triggers:
      - trigger: calendar
        event: start
        offset: "-0:10:0"
        entity_id: calendar.work
    actions:
      - action: rest_command.tv_notify
        data:
          notice:
            kind: meeting
            title: "{{ trigger.calendar_event.summary }} in 10 minutes"
            text: "{{ trigger.calendar_event.location | default('') }}"
```

A live camera stream is a web address the TV plays as `video`, as long as it's MP4 or WebM over
http (the TV can't play RTSP or HLS in a pop-up). A snapshot as `image` is the most reliable.
