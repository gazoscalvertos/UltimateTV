# The phone remote

Any phone on the home Wi-Fi can drive the TV: arrows and OK, Back, Home, Guide, Info, the colour keys, numbers, channel up and down, play controls, and typing for search. Key presses go to the Hub, and the Hub passes them to the TV app.

![Phone remote](screenshots/22-phone-remote.png)

## As a web app (any phone)

On the TV, open **Settings › Phone remote** and scan the code, or open `http://192.168.0.19:8095/remote/` on the phone. In Chrome, choose **Add to Home screen**.

## As an Android app

The Android app is the same remote in its own app, with two extras: the phone's **volume keys change channel** and the phone's **Back** button is the TV's Back. It keeps the phone's screen on while it's open.

1. Get `app-debug.apk` from the latest **CI** run on GitHub (Actions › CI › the `ultimatetv-remote-apk` artifact), or build it with `cd android && gradle assembleDebug`.
2. Copy it to the phone and open it. Android asks to allow installing from that app the first time.
3. Open **UltimateTV Remote**. It suggests `http://192.168.0.19:8095`; change it if the Hub's address is different, and tap **Connect**.

To point it at a different Hub later, use **Change Hub** at the bottom of the remote.

## Tips

- Swipe on the pad to move, tap to press OK, and hold an arrow to repeat.
- Type in the text box at the bottom and press **Send** to type into the TV's search box.
- The phone remote keeps working once the TV remote works over CEC, so both can be used.
