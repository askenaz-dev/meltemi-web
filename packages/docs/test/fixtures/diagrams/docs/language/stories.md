# Stories

[Español](../es/language/stories.md)

A `story` tells a diagram step by step: scenes that reveal, highlight and trace parts of it, on
the same clock as the motion effects.

```text
language "0.2"

diagram checkout: flow {
  title "Checkout"
  direction LR

  client["Client app"]
  api["Order API"]
  db[("Orders DB")]

  client -> api: "HTTPS" as request
  api -> db: "Persist" as save
}

story purchase for checkout {
  title "A purchase"

  scene overview {
    reveal client, api, db over 800ms
    hold 1s
  }

  scene processing {
    trace request over 1200ms
    trace save over 1200ms
    hold 2s
  }
}
```

The purchase lasts 6.2 s: `overview` takes 0.8 + 1 s, `processing` 1.2 + 1.2 + 2 s.

## Actions

An action names its targets and, optionally, its time:

```text
reveal client, api over 800ms
```

## Exports

To export a story as a video, give the story and a video format: the frames are drawn on the
story's clock, so the video lasts as long as the story.

```text
The video is 1920 by 1080 pixels at 30 frames a second.
```
