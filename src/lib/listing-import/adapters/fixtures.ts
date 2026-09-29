/**
 * Sanitized fixture documents for adapter tests — deterministic stand-ins for
 * the engines and page shapes the importer must read. CI never touches a live
 * forum or Facebook; these fixtures ARE the contract the extractors satisfy.
 */

export const XENFORO_THREAD = `<!DOCTYPE html>
<html id="XF" data-template="thread_view">
<head>
  <title>FS: APR Stage 2 Downpipe MK7 GTI | GolfMK7</title>
  <meta property="og:title" content="FS: APR Stage 2 Downpipe MK7 GTI" />
  <link rel="canonical" href="https://forum.example/threads/fs-apr-downpipe.412/" />
</head>
<body>
<div class="p-body">
  <h1 class="p-title-value">FS: APR Stage 2 Downpipe MK7 GTI</h1>
  <article class="message" data-author="sellerGuy">
    <img src="https://forum.example/data/avatars/m/1/sellerguy.jpg" alt="avatar" class="avatar" />
    <div class="message-body">
      <div class="bbWrapper">Selling my APR cast downpipe off my 2017 GTI.<br />
      $450 shipped OBO. Fits mk7 / mk7.5 GTI, needs a stage 2 tune.<br />
      Some heat discoloration, no dents. Part number DPK0018.
      <img src="https://forum.example/attachments/downpipe-front-jpg.99871/" data-url="https://forum.example/attachments/downpipe-front-jpg.99871/" class="bbImage" alt="downpipe" />
      <blockquote>quoting someone else's reply should never leak in</blockquote>
      </div>
    </div>
    <div class="attachmentList">
      <a href="https://forum.example/attachments/downpipe-side-jpg.99872/" class="file-preview">side</a>
    </div>
  </article>
  <article class="message" data-author="bumper">
    <div class="message-body"><div class="bbWrapper">bump — still available?</div></div>
  </article>
</div>
</body></html>`;

export const VBULLETIN_THREAD = `<!DOCTYPE html>
<html>
<head>
  <meta name="generator" content="vBulletin 4.2.5" />
  <title>FS: Bilstein B16 coilovers B8 S4</title>
</head>
<body>
<h1 class="threadtitle">FS: Bilstein B16 coilovers B8 S4</h1>
<ol id="postlist">
  <li id="post_101" class="postcontainer">
    <div id="post_message_101" class="postcontent">
      Bilstein B16 PSS10 off my B8 S4. About 15k miles on them. $900 + shipping, OBO.
      Located in Austin TX. <img src="https://img.example/coilovers1.jpg" width="800" height="600" />
    </div>
  </li>
  <li id="post_102" class="postcontainer">
    <div id="post_message_102" class="postcontent">glws, these are great</div>
  </li>
</ol>
</body></html>`;

export const PHPBB_TOPIC = `<!DOCTYPE html>
<html>
<head><title>FS: OEM ND2 Miata wheels • Forum</title></head>
<body id="phpbb">
<h2 class="topic-title"><a href="#">FS: OEM ND2 Miata wheels</a></h2>
<div class="post has-profile">
  <div class="postbody">
    <div class="content">Set of four OEM ND2 wheels, light curb rash on one. $600 pickup only, San Diego.
      <img src="https://img.example/wheels.jpg" width="1024" height="768" />
    </div>
  </div>
</div>
<div class="post">
  <div class="postbody"><div class="content">pm sent</div></div>
</div>
<!-- powered by phpBB -->
</body></html>`;

export const DISCOURSE_SHELL = `<!DOCTYPE html>
<html>
<head>
  <meta name="generator" content="Discourse 3.2.0" />
  <title>FS: 034 dogbone mount insert - Marketplace - Some Forum</title>
</head>
<body><section id="main"><noscript>JS needed</noscript></section></body></html>`;

export const DISCOURSE_TOPIC_JSON = JSON.stringify({
  title: "FS: 034 dogbone mount insert",
  post_stream: {
    posts: [
      {
        post_number: 1,
        cooked:
          '<p>034 Motorsport dogbone insert, street density. $60 shipped CONUS.</p><p>Came off my 8V S3 — fits A3/S3/Golf R.</p><p><a href="https://forum.example/uploads/insert.jpg"><img src="https://forum.example/uploads/optimized/insert_600x400.jpg" width="600" height="400"></a></p><aside class="quote">someone quoted</aside>',
      },
      { post_number: 2, cooked: "<p>bump</p>" },
    ],
  },
});

export const GENERIC_JSONLD_LISTING = `<!DOCTYPE html>
<html>
<head>
  <title>APR Turbo Inlet — Shop</title>
  <link rel="canonical" href="https://shop.example/products/apr-turbo-inlet" />
  <meta property="og:title" content="APR Turbo Inlet" />
  <meta property="og:description" content="High-flow turbo inlet for the EA888 Gen 3." />
  <meta property="og:image" content="https://shop.example/img/inlet-main.jpg" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "APR Turbo Inlet",
    "description": "High-flow turbo inlet for the EA888 Gen 3. Used, excellent condition.",
    "mpn": "MS100141",
    "image": ["https://shop.example/img/inlet-1.jpg", "https://shop.example/img/inlet-2.jpg"],
    "offers": {
      "@type": "Offer",
      "price": "189.00",
      "priceCurrency": "USD",
      "itemCondition": "https://schema.org/UsedCondition",
      "availability": "https://schema.org/InStock"
    }
  }
  </script>
</head>
<body><main><h1>APR Turbo Inlet</h1><p>High-flow turbo inlet for the EA888 Gen 3. Used, excellent condition. $189.</p></main></body></html>`;

/**
 * Facebook Marketplace item pages, in the shape Facebook served logged-out
 * readers in September 2026 (keys and nesting copied from captured pages;
 * seller data invented). What matters about the shape:
 *
 *  - the listing's data is split over several `<script type="application/
 *    json" data-sjs>` blobs, joined by the item's own `id`
 *  - the page ALSO embeds ~20 recommended listings with the same keys
 *    (`marketplace_listing_title`, `listing_price`, `formatted_price`) —
 *    and they come FIRST in the document
 *  - the listing's own price is `listing_price.formatted_amount_zeros_stripped`
 *    + `currency`; the neighbours carry `formatted_price.text`
 *  - OpenGraph has the title, description and ONE square-cropped photo
 *  - the logged-out chrome includes login markup even on a readable listing
 */
export type FacebookFixtureListing = {
  id: string;
  title: string;
  description: string;
  formattedPrice: string;
  amount: string;
  currency: string;
  location: string;
  condition: string;
  photos: string[];
  sold?: boolean;
};

export const FACEBOOK_EVO_EXHAUST: FacebookFixtureListing = {
  id: "751559927777591",
  title: "Evo X Turbo XS exhaust",
  description: "Turbo XS catback off my Evo X. Works perfectly, no leaks. Pickup San Bruno.",
  formattedPrice: "$200",
  amount: "200.00",
  currency: "USD",
  location: "San Bruno, CA",
  condition: "Used - Good",
  photos: [
    "https://scontent.example/v/t39/exhaust-1.jpg",
    "https://scontent.example/v/t39/exhaust-2.jpg",
    "https://scontent.example/v/t45/exhaust-3.jpg",
    "https://scontent.example/v/t45/exhaust-4.jpg",
  ],
};

export const FACEBOOK_XR50_WHEELS: FacebookFixtureListing = {
  id: "491182723643598",
  title: "XR50 Turbo Wheels",
  description:
    "Good condition, bought for my car but ended up getting a different set. Tyres driven on for a week.\n\nPickup Cleveland 4163",
  formattedPrice: "A$1,850",
  amount: "1850.00",
  currency: "AUD",
  location: "Brisbane, QLD",
  condition: "Used - like new",
  photos: ["https://scontent.example/v/t45/xr50-1.jpg", "https://scontent.example/v/t45/xr50-2.jpg"],
};

/** Recommended listings Facebook embeds beside every item. */
const FACEBOOK_NEIGHBOURS = [
  { id: "2110552923671350", title: "Pelican Sit-in Kayak", price: "$100", amount: "100.00" },
  { id: "1864876901559311", title: "Royal Court Estelle Blush Boudoir Pillow", price: "$25", amount: "25.00" },
  { id: "1523951983027207", title: "2004 VY Commodore", price: "$1,500", amount: "1500.00" },
];

function facebookSjs(payload: unknown): string {
  return `<script type="application/json" data-content-len="1" data-sjs>${JSON.stringify(payload)}</script>`;
}

export function facebookMarketplacePage(listing: FacebookFixtureListing): string {
  const feed = {
    require: [["ScheduledServerJS", "handle", null, [{ __bbox: { result: { data: { viewer: {
      marketplace_feed_stories: { edges: FACEBOOK_NEIGHBOURS.map((n) => ({ node: { listing: {
        __typename: "GroupCommerceProductItem",
        id: n.id,
        marketplace_listing_title: n.title,
        custom_title: null,
        primary_listing_photo: { image: { uri: `https://scontent.example/v/neighbour-${n.id}.jpg` }, id: `p${n.id}` },
        listing_price: { amount: n.amount },
        formatted_price: { text: n.price },
        location: { reverse_geocode: { city: "Oakland", state: "CA" } },
        is_sold: false,
      } } })) },
    } } } } }]]],
  };
  const photos = {
    require: [["RelayPrefetchedStreamCache", "next", [], ["adp_MarketplacePDPContainerQuery", { __bbox: { result: { data: {
      viewer: { marketplace_product_details_page: { target: {
        __typename: "GroupCommerceProductItem",
        id: listing.id,
        listing_photos: listing.photos.map((uri, i) => ({
          __typename: "ProductImage",
          accessibility_caption: "No photo description available.",
          image: { height: 960, width: 720, uri },
          id: `${listing.id}${i}`,
        })),
      } } },
    } } } }]]],
  };
  const details = {
    require: [["RelayPrefetchedStreamCache", "next", [], ["adp_MarketplacePDPC2CMediaViewerWithImagesQuery", { __bbox: { result: { data: {
      viewer: { marketplace_product_details_page: {
        marketplace_listing_renderable_target: {
          __typename: "GroupCommerceProductItem",
          id: listing.id,
          base_marketplace_listing_title: listing.title,
          marketplace_listing_title: listing.title,
          is_shipping_offered: false,
        },
        target: {
          __typename: "GroupCommerceProductItem",
          id: listing.id,
          redacted_description: { text: listing.description },
          creation_time: 1755443497,
          location_text: { text: listing.location },
          delivery_types: ["IN_PERSON"],
          listing_price: {
            formatted_amount_zeros_stripped: listing.formattedPrice,
            amount_with_offset_in_currency: "20000",
            amount: listing.amount,
            currency: listing.currency,
          },
          strikethrough_price: null,
          marketplace_listing_title: listing.title,
          is_live: true,
          is_pending: false,
          is_sold: Boolean(listing.sold),
          attribute_data: [{ attribute_name: "Condition", value: "used", label: listing.condition }],
        },
      } },
    } } } }]]],
  };
  const url = `https://www.facebook.com/marketplace/item/${listing.id}/`;
  return `<!DOCTYPE html>
<html>
<head>
  <title>Facebook</title>
  <meta property="og:type" content="video.other" />
  <meta property="og:title" content="${listing.title}" />
  <meta property="og:description" content="${listing.description.split("\n")[0]}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${listing.photos[0]}?ctp=p600x600" />
</head>
<body>
<div role="banner"><form id="login_form" action="/login/"><input name="email" /><button name="login" id="loginbutton">Log in</button></form></div>
${facebookSjs(feed)}
${facebookSjs(photos)}
${facebookSjs(details)}
</body></html>`;
}

/** A page whose embedded data is gone (format change) but OpenGraph is not. */
export const FACEBOOK_OPENGRAPH_ONLY = `<!DOCTYPE html>
<html>
<head>
  <title>Facebook</title>
  <meta property="og:title" content="APR Intercooler MK7 GTI/R" />
  <meta property="og:description" content="APR intercooler off my mk7 Golf R. Some bent fins, works perfectly." />
  <meta property="og:url" content="https://www.facebook.com/marketplace/item/1234567890/" />
  <meta property="og:image" content="https://scontent.example/v/ic1.jpg" />
</head>
<body>${facebookSjs({ require: [["ScheduledServerJS", "handle", null, [{ __bbox: { result: { data: { viewer: {
  marketplace_feed_stories: { edges: [{ node: { listing: { id: "2110552923671350", marketplace_listing_title: "Pelican Sit-in Kayak", formatted_price: { text: "$100" } } } }] },
} } } } }]]] })}</body></html>`;

/** What Facebook serves for a deleted or sold-and-removed listing: HTTP 200,
 *  no OpenGraph, and the Comet error root. */
export const FACEBOOK_LISTING_GONE = `<!DOCTYPE html>
<html>
<head><title>Facebook</title><meta name="color-scheme" content="light" /></head>
<body>${facebookSjs({ require: [["CometSSRMergedContentInjector", "onPayloadReceived", null, [{
  initialRouteInfo: { route: { actorID: "0", rootView: { allResources: [{ __dr: "CometErrorRoot.react" }],
    resource: { __dr: "CometErrorRoot.react" },
    props: { title: "This content isn't available right now", body: "When this happens, it's usually because the owner only shared it with a small group of people." } } } },
}]]] })}</body></html>`;

export const FACEBOOK_LOGIN_WALL = `<!DOCTYPE html>
<html>
<head><title>Log in to Facebook</title></head>
<body>
<form id="login_form" action="/login/device-based/regular/login/" method="post">
  <input name="email" /><input name="pass" type="password" />
  <button name="login" id="loginbutton">Log In</button>
</form>
</body></html>`;
