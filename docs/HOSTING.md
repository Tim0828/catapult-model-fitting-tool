# Hosting

The students' tool is a set of static files, and all computation runs in each student's browser. Any way of
getting `web/` onto their devices works. Choose based on the venue.

| Option | Needs | Good for |
|---|---|---|
| Raspberry Pi as its own Wi-Fi hotspot | a Pi (3B+ or newer) | Lessons at schools: no dependence on school Wi-Fi, works offline |
| GitHub Pages / any web host | internet | Sharing the tool beforehand, students at home |
| USB stick / local file | nothing | Laptops without a network; open `web/index.html` |

Only the optional scoreboard needs a running server, and only the referee and the projector use it.

## Raspberry Pi hotspot (recommended for lessons)

These steps are for Raspberry Pi OS Bookworm, which uses NetworkManager.

```sh
# 1. Software
sudo apt update && sudo apt install -y nginx python3-venv git

# 2. Files (copy the catapult-tool folder to /srv/catapult)
sudo mkdir -p /srv/catapult && sudo chown pi:pi /srv/catapult
cp -r catapult-tool/* /srv/catapult/

# 3. Static site
sudo cp /srv/catapult/deploy/nginx-catapult.conf /etc/nginx/sites-available/catapult
sudo ln -sf /etc/nginx/sites-available/catapult /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 4. Wi-Fi hotspot that starts on boot
sudo nmcli device wifi hotspot ifname wlan0 ssid Catapult password "choose-a-password"
sudo nmcli connection modify Hotspot connection.autoconnect yes
```

Students join the `Catapult` network and browse to **http://10.42.0.1/**, the Pi's address on its own hotspot.
Print that address as a QR code on the worksheet. `raspberrypi.local` does not resolve on every Android or
Chromebook device, so use the IP address.

### Scoreboard on the Pi

```sh
python3 -m venv /srv/catapult/venv
/srv/catapult/venv/bin/pip install -r /srv/catapult/scoreboard/requirements.txt
sudo nano /srv/catapult/deploy/catapult-scoreboard.service   # set SCOREBOARD_PIN
sudo cp /srv/catapult/deploy/catapult-scoreboard.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now catapult-scoreboard
```

* Projector: http://10.42.0.1:5000/ (refreshes every 3 s)
* Referee: http://10.42.0.1:5000/referee (enter the PIN once per browser session)
* To link it from the students' tool, set `scoreboardUrl: "http://10.42.0.1:5000/"` in `web/js/config.js`.

Scores are stored in `/srv/catapult/scoreboard/scoreboard.db`. Delete that file between events to start fresh.

### Load

nginx serving under 100 KB of static files to 30 devices is negligible load for any Pi. The scoreboard handles one
write per shot plus a poll from the projector every 3 seconds.

## GitHub Pages

The repository includes a workflow at [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) that publishes
the contents of `web/` whenever `master` is updated. There is no build step.

To enable it for a repository:

1. Push the workflow to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. Push to `master`, or start **Deploy web app to GitHub Pages** from the **Actions** tab.

The resulting site is normally available at
`https://<owner>.github.io/<repository>/`. The optional Flask scoreboard is not deployed by this workflow; it needs
a server such as the Raspberry Pi setup described above.

## Why not PlutoSliderServer?

The review explains this in detail. In short: a static export can only precompute slider combinations, which
explodes with 3+ continuous sliders plus data entry. Live mode sends every slider movement to Julia on the Pi,
which is slow for 20–30 simultaneous students. Computing in the browser avoids both problems.
