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

export const FACEBOOK_MARKETPLACE_PUBLIC = `<!DOCTYPE html>
<html>
<head>
  <title>Marketplace - APR Intercooler MK7 | Facebook</title>
  <meta property="og:title" content="APR Intercooler MK7 GTI/R" />
  <meta property="og:description" content="$450 · APR intercooler off my mk7 Golf R. Some bent fins, works perfectly. Fort Lauderdale, FL. Shipped OBO." />
  <meta property="og:image" content="https://scontent.example/v/ic1.jpg" />
  <meta property="og:url" content="https://www.facebook.com/marketplace/item/1234567890/" />
</head>
<body>
<script>window.__data = {"marketplace_listing_title":"APR Intercooler MK7 GTI\\/R","formatted_amount":"$450","redacted_description":{"text":"APR intercooler off my mk7 Golf R. Some bent fins, works perfectly. $450 shipped OBO."},"location_text":{"text":"Fort Lauderdale, FL"}};</script>
<div id="content">APR intercooler listing</div>
</body></html>`;

export const FACEBOOK_LOGIN_WALL = `<!DOCTYPE html>
<html>
<head><title>Log in to Facebook</title></head>
<body>
<form id="login_form" action="/login/device-based/regular/login/" method="post">
  <input name="email" /><input name="pass" type="password" />
  <button name="login" id="loginbutton">Log In</button>
</form>
</body></html>`;
