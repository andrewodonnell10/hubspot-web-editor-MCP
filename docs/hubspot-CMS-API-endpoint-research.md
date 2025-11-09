# Building an AI-Powered HubSpot CMS Editor: Complete Technical Guide

**Claude can safely edit HubSpot website content through a carefully designed MCP server using the CMS API, but success depends on embracing the draft-first workflow, understanding critical nested object limitations, and implementing robust safety mechanisms.** The API provides comprehensive CRUD operations for pages, blog posts, templates, and files, yet HubSpot explicitly warns against direct content modification via API—making a hybrid approach essential where AI handles metadata and structured content while preserving visual editing capabilities for complex layouts.

This research reveals **three critical constraints** that define safe implementation: partial updates aren't supported for nested properties (requiring full object definitions), rate limits vary dramatically by subscription tier (100-250 requests per 10 seconds), and the draft/publish architecture provides the safety net needed for AI-assisted editing. For Core Wrk's educational content series and marketing pages, the API excels at blog post management, metadata optimization, and scheduling workflows, while requiring careful handling of drag-and-drop layouts and complex page structures.

The path forward involves building MCP tools that work *with* HubSpot's strengths rather than against them—treating drafts as the primary workspace, implementing fetch-first patterns to preserve content integrity, and designing workflows that keep humans in the approval loop. This guide provides the complete technical foundation, from authentication setup through production deployment, with specific emphasis on the gotchas that could break live content if ignored.

## HubSpot CMS API architecture and capabilities

The HubSpot CMS API operates on a **dual-version architecture** where every piece of content maintains separate draft and published states. This fundamental design pattern provides the foundation for safe AI-assisted editing, allowing modifications to accumulate in draft form before explicit publication. The API spans eight major endpoint categories, each with distinct capabilities and constraints.

**Pages and blog posts** form the content core, accessible through `/cms/v3/pages/{site-pages|landing-pages}` and `/cms/v3/blogs/posts` respectively. Both support full CRUD operations with sophisticated filtering using operators like `eq`, `contains`, `gt`, `gte`, and `in`. Pages can be filtered by state, publish date, domain, folder, language, and template path, while blog posts add author and tag filtering. The critical distinction: **pages require explicit draft endpoint usage** (`/draft` suffix) for modifications, whereas blog posts can be updated directly with state management through the `state` property.

The **content structure hierarchy** follows a nested pattern that proves both powerful and treacherous. Pages contain three primary content containers: `widgets` (module data in templates), `widgetContainers` (module data in flex columns), and `layoutSections` (module data in drag-and-drop areas). Each layoutSection contains rows, which contain cells, which contain widgets, each with their own styling and parameters. This deep nesting creates the fundamental challenge: **HubSpot's API does not support partial updates for these nested properties**. Attempting to modify a single widget property without including the complete object definition will delete all other widgets in that container.

**Templates and modules** live in the Developer File System, accessed through `/cms/v3/source-code/{environment}/{action}/{path}` where environment is either `draft` or `published`. Templates combine HTML with HubL (HubSpot's templating language) and can include module tags, drag-and-drop areas, and flexible columns. Modules are directories ending in `.module` containing module.html, module.css, module.js, fields.json, and meta.json files. The Source Code API supports upload, download, validation, and deletion operations, with a critical behavior: **publishing to the `published` environment clears the current draft**.

**Files and assets** route through two distinct systems. The File Manager API (`/files/v3/files`) handles static files served via CDN—images, PDFs, documents—with three access levels: `PUBLIC_INDEXABLE` (searchable), `PUBLIC_NOT_INDEXABLE` (public but not indexed), and `PRIVATE` (requires signed URL). The Design Manager stores developer files with minification support for JS/CSS. File uploads require multipart/form-data with explicit `access` and `folderPath` properties. Supported file types include css, js, json, html, txt, md, jpg, jpeg, png, gif, map, svg, ttf, woff, woff2, and zip.

**HubDB provides structured data storage** for dynamic content through `/cms/v3/hubdb/tables` with its own draft/live system. Tables support 13 column types from TEXT and NUMBER through RICHTEXT, VIDEO, CURRENCY, and LOCATION. The filtering syntax mirrors pages (`columnName__operator=value`) with operators like `contains`, `icontains`, `startswith`, and `geo_distance` for location searches. HubDB includes CSV import capabilities with configurable encoding, column mapping, and primary keys. The significant limitation: **unauthenticated public access is possible but requires explicit configuration**, and dynamic pages are limited to 10 per data source.

**URL mappings and redirects** operate through `/url-mappings/v3/url-mappings` supporting pattern-based redirects, regex patterns, and full-URL matching with `isMatchFullUrl` and `isMatchQueryString` parameters. The API handles redirect types, precedence ordering, and 404-only triggers through `isOnlyAfterNotFound`. The domains API (`/cms/v3/domains`) provides read-only access to domain configuration and SSL status—domain creation and modification must happen through the HubSpot UI.

Rate limits and pagination define the operational boundaries. All list endpoints support `limit` (max 100-200 depending on endpoint) and `offset` or `after` cursor parameters. Responses include `total` count for the full result set and `paging` object with `next` links. State filtering accepts values like `DRAFT`, `PUBLISHED_OR_SCHEDULED`, `DRAFT_AB`, `PUBLISHED_AB`, and several A/B test variants. Multi-language content uses `language` (ISO 639 codes), `translatedFromId` (primary language page ID), and `translations` (map of variants).

## Authentication, authorization, and security implementation

**Private apps represent the recommended authentication method** for single-account integrations like the proposed MCP server for Core Wrk. Creating a private app requires Super Admin access through Settings → Integrations → Private Apps, where you define scopes, generate an access token, and optionally configure webhooks. The token is static (doesn't expire automatically) but should be rotated every 6 months, either immediately with "Rotate and expire now" or on a 7-day schedule with "Rotate and expire later."

Access tokens authenticate via the Authorization header: `Authorization: Bearer YOUR_PRIVATE_APP_TOKEN`. The token format follows OAuth protocol as its base with a maximum length of 512 characters. HubSpot automatically reminds Super Admins if tokens haven't been rotated in 180+ days. **Critical constraint: maximum 20 private apps per account**, and if the creator is removed from the account, some API calls may fail requiring token rotation.

The **required CMS scopes** form a comprehensive permission model. For Core Wrk's use case, you'll need `content` (broad access to sites, landing pages, blog, email), `cms.domains.read` for domain listing, `files` for file uploads, and `hubdb` for dynamic content tables. More granular options include `cms.knowledge_base.articles.read/write/publish` (Service Hub Pro+ required), `cms.functions.read/write` (Content Hub Enterprise serverless functions), `cms.membership.access_groups.read/write` (membership management), and GraphQL API scopes `collector.graphql_query.execute` and `collector.graphql_schema.read`.

Permission levels follow a clear hierarchy: **read access** (view-only with `.read` suffix), **write access** (create, update, delete, usually includes read), and **publish access** (highest level, makes content live). When selecting scopes, use the most granular options possible following the principle of least privilege. For example, if you only need to read and write blog posts without touching knowledge base content, request `content` rather than all `cms.*` scopes.

**Rate limits vary dramatically by account tier** and represent the most critical operational constraint. Free and Starter accounts allow 100 requests per 10 seconds with a 250,000 daily limit. Professional and Enterprise accounts increase to 190 requests per 10 seconds with 625,000 (Pro) or 1,000,000 (Enterprise) daily limits. With API Limit Increase capacity packs, the burst limit reaches 250 requests per 10 seconds and daily limits can increase by +1,000,000 per pack (purchasable twice for +2,000,000 total).

OAuth apps face different constraints: **110 requests per 10 seconds per HubSpot account** regardless of subscription level, and the API Limit Increase does NOT apply. The Search API enforces its own separate limit of **5 requests per second per authentication token**, significantly more restrictive than general API limits. Each private app has its own burst limit, but all private apps collectively share the daily limit.

Every API response includes critical rate limit headers: `X-HubSpot-RateLimit-Daily` (total allowed), `X-HubSpot-RateLimit-Daily-Remaining` (remaining today), `X-HubSpot-RateLimit-Interval-Milliseconds` (burst window, typically 10000), `X-HubSpot-RateLimit-Max` (burst limit), and `X-HubSpot-RateLimit-Remaining` (remaining in current burst). These headers are essential for implementing intelligent throttling.

When rate limits are exceeded, the API returns HTTP 429 with JSON containing `policyName` of either `DAILY` or `TEN_SECONDLY_ROLLING`. **Best practice dictates keeping error rates under 5% of total requests**—marketplace apps must meet this threshold for certification. Daily limits reset at midnight in the account's configured timezone.

**Token storage and rotation policies** form the security foundation. Store private app tokens in environment variables or secure secret management services (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault). Never hardcode tokens in source code, commit them to version control, or share via insecure channels. For OAuth implementations, store refresh tokens in encrypted databases and access tokens in memory or short-lived cache with the `expires_in` timestamp.

OAuth access tokens expire after 30 minutes and must be refreshed using the refresh token through `POST /oauth/v1/token` with `grant_type=refresh_token`. The refresh token itself doesn't expire unless the app is uninstalled or scopes are modified. Handle 401 Unauthorized errors by attempting token refresh for OAuth or checking for token rotation/deletion for private apps. Log all errors without exposing token values, and implement circuit breakers for repeated authentication failures.

## Content editing workflows and technical implementation

**HubSpot explicitly warns against modifying page content via API**, stating "the content editor in HubSpot is the simplest way to modify website content." This official guidance reflects the complexity and fragility of programmatic content manipulation. The API excels at structural operations—metadata updates, publishing workflow management, bulk operations—but struggles with the nuanced visual editing that the UI provides with WYSIWYG preview, auto-save protection, and validation feedback.

The **fetch-first pattern is absolutely mandatory** for safe content updates. Always GET the current page or blog post state, modify the JSON response locally, then PATCH with the complete object definition. This pattern is not optional—it's the only way to prevent data loss given HubSpot's lack of merge semantics for nested properties.

For blog post creation, the full workflow involves:

```json
POST /cms/v3/blogs/posts
{
  "name": "Internal Post Name",
  "slug": "url-slug",
  "contentGroupId": "{blog-id}",
  "blogAuthorId": 12345,
  "htmlTitle": "SEO Title",
  "postBody": "<p>HTML content</p>",
  "postSummary": "Brief summary for listings",
  "metaDescription": "Meta description",
  "tagIds": [123, 456],
  "state": "DRAFT",
  "useFeaturedImage": true,
  "featuredImage": "https://files.hubspot.com/...",
  "featuredImageAltText": "Image description"
}
```

**Critical gotcha: use `state` property, not `currentState`** for controlling publication. Setting `currentState` alone won't publish content. For immediate publication use `state: "PUBLISHED_OR_SCHEDULED"` or set a future `publishDate` for scheduling.

Blog post updates follow a dual-path approach. For draft-only changes: `PATCH /cms/v3/blogs/posts/{postId}/draft` with modified properties. To publish draft changes to live: `POST /cms/v3/blogs/posts/{postId}/draft/push-live` (no payload required). To discard draft changes: `POST /cms/v3/blogs/posts/{postId}/draft/reset`. For posts already published, you can also update directly with `PATCH /cms/v3/blogs/posts/{postId}` and set `state: "PUBLISHED_OR_SCHEDULED"` to publish immediately.

**Pages introduce more complexity** through their nested content structures. The `layoutSections` object contains drag-and-drop areas with a hierarchy of rows → cells → widgets. Each widget has a `type`, `body` (with HTML content), and `params` (module-specific settings). The treacherous aspect: when you PATCH a page draft with `layoutSections`, you must include the ENTIRE structure. If the current page has 3 widgets and you send a layoutSections object with only 1 widget, the other 2 are permanently deleted.

Safe page modification workflow:

```javascript
// 1. Fetch complete current state
const response = await fetch('/cms/v3/pages/site-pages/12345', {
  headers: { 'Authorization': 'Bearer TOKEN' }
});
const page = await response.json();

// 2. Modify specific properties
page.htmlTitle = "New Title";
page.metaDescription = "New description";

// 3. If modifying content, update nested structure carefully
page.layoutSections.dnd_area.rows[0].cells[0].widgets[0].body.html = 
  "<h2>Updated</h2><p>New content</p>";

// 4. PATCH draft with complete objects
await fetch('/cms/v3/pages/site-pages/12345/draft', {
  method: 'PATCH',
  body: JSON.stringify({
    htmlTitle: page.htmlTitle,
    metaDescription: page.metaDescription,
    layoutSections: page.layoutSections  // Must be complete
  })
});

// 5. Publish when ready
await fetch('/cms/v3/pages/site-pages/12345/draft/push-live', {
  method: 'POST'
});
```

**Rich text and HTML content** accepts standard HTML tags (p, div, h1-h6, strong, em, a, img) with inline styles supported. Blog post bodies use the `postBody` property with full HTML. Page content in layoutSections uses widgets with `body.html` properties. HubL (HubSpot's templating language) is supported in templates and modules but not in page content via API—HubL rendering happens server-side based on template definitions.

**Module parameters** define configurable fields in custom modules through fields.json files. Common field types include text, richtext, number, boolean, color, image, url, date, and choice. When updating module parameters via API, reference them by field name in the `params` object within widget definitions. The challenge: you need to know the module's field schema beforehand, which requires fetching the module definition via Source Code API or understanding the template structure.

File uploads through the Files API require multipart/form-data with specific structure:

```bash
POST /files/v3/files
Content-Type: multipart/form-data

file: [binary data]
options: {
  "access": "PUBLIC_INDEXABLE",
  "ttl": "P3M",
  "duplicateValidationStrategy": "REJECT"
}
folderPath: "/images/blog"
```

The response includes `url` property with the CDN path, which can then be used in `featuredImage` or embedded in content HTML. **Access level is required** and determines both visibility and SEO indexing. Use PUBLIC_INDEXABLE for images and content files, PUBLIC_NOT_INDEXABLE for downloadable resources you don't want indexed, and PRIVATE for authenticated-only access.

**Pagination strategies** become essential for bulk operations. Blog posts return maximum 100 per request, requiring offset-based iteration:

```python
offset = 0
limit = 100
all_posts = []

while True:
    posts = fetch(f'/cms/v3/blogs/posts?limit={limit}&offset={offset}')
    all_posts.extend(posts['results'])
    if len(posts['results']) < limit:
        break
    offset += limit
    time.sleep(0.1)  # Rate limit protection
```

For pages, the same pattern applies. Always monitor the `total` count in responses to know how many total items exist, and implement rate limit protection through delays between batch requests. A token bucket implementation provides smoother rate limiting than simple delays.

## Draft workflows, versioning, and safety mechanisms

The **draft/publish architecture provides the essential safety net** for AI-assisted content editing. Every page and blog post maintains two independent versions: a draft (unpublished, editable) and a published (live, visible to visitors). Modifications via API should always target draft endpoints first, allowing review before publication.

Creating content as draft uses `state: "DRAFT"` in the initial POST request. For pages: `POST /cms/v3/pages/site-pages` with `state: "DRAFT"`. For blog posts: `POST /cms/v3/blogs/posts` with `state: "DRAFT"`. The draft exists independently and can be modified repeatedly without affecting any live content.

**Draft modification endpoints** follow a consistent pattern with `/draft` suffix: `PATCH /cms/v3/pages/{pageType}/{objectId}/draft` and `PATCH /cms/v3/blogs/posts/{postId}/draft`. These operations are completely isolated from published versions. Changes accumulate in draft until explicitly published, providing an accumulation zone for AI-generated modifications that humans can review through HubSpot's preview interface.

Publishing operations come in several flavors. **Push draft to live** uses `POST /{objectId}/draft/push-live` and requires the page/post to already have a published version—it updates an existing published page with draft changes. **Schedule publication** uses `POST /{objectId}/schedule` with payload `{"id": "page-id", "publishDate": "2024-12-31T09:00:00Z"}` for coordinated launches. **Direct publish** sets `state: "PUBLISHED_OR_SCHEDULED"` when creating or updating content to skip draft stage.

The **reset draft operation** discards all unpublished changes: `POST /{objectId}/draft/reset`. This is non-reversible and reverts draft to match current live version. Use this when draft modifications go off track and you want to start over from the known-good live state.

**Version history provides rollback capabilities** through revision tracking. Every "Save" operation in the content editor creates a version snapshot. Publishing creates a new version. Changes tracked include content modifications, template changes, settings updates, user information, and timestamps. **Critical behavior: unpublished pages store all changes as versions until published, but published pages don't store new edits in version history until published again.**

Accessing revisions via API uses `GET /cms/v3/pages/{objectId}/revisions` and `GET /cms/v3/blogs/posts/{objectId}/revisions`. Responses include full page/post data at each version plus user and timestamp information. Retrieving specific revisions: `GET /cms/v3/blogs/posts/{objectId}/revisions/{revisionId}` returns complete object state at that point in time.

**Rollback mechanisms differ by content type.** For blog posts, direct restoration exists: `POST /cms/v3/blogs/posts/{objectId}/revisions/{revisionId}/restore`. The restored version becomes current draft (not immediately published). For pages, workaround approach required: fetch historical revision via GET, extract content, update current draft with historical content via PATCH, then publish. **Deleted pages cannot be restored via API**—requires HubSpot Customer Support intervention.

**Validation happens primarily at template and module level** rather than page content level. The Source Code API provides validation endpoint: `POST /cms/v3/source-code/{environment}/validate/{path}` with multipart/form-data containing the file. This validates HubL syntax in templates/modules and JSON structure for themes/modules. Response is 200 OK for valid files or 400 Bad Request with error details matching Design Manager warnings.

For page and blog content, **no dedicated validation endpoint exists**. Validation happens during publish, not before. Required fields enforce some validation: pages need `name` and `templatePath`, blog posts need `name`, `contentGroupId`, and `slug`. Beyond required fields, content validation is minimal—broken links, invalid HTML, and SEO issues won't prevent publication.

**Testing and staging environments** provide isolated workspaces. Content Staging (CMS Hub Professional+) offers a separate staging domain (`your-domain.sandbox.hs-sites.com`) where you can clone existing live pages, create new staged pages, edit in "Staged draft" mode, publish to "Staged proof" for review, and batch publish to production when ready. **Critical limitation: changes to templates, global content, or HubDB tables in Content Staging affect live pages immediately**—you must clone these resources before editing.

Standard Sandbox Accounts (Enterprise) mirror production account configuration, sync up to 5,000 contacts automatically (up to 200,000 via manual import), and support testing integrations without production impact. These sync CRM object definitions, custom properties, CMS themes, templates, and coded files. **Not recommended for website redesigns**—templates can't be transferred back to production easily.

**A/B testing operates through specific API endpoints.** Create variant: `POST /cms/v3/pages/{pageType}/ab-test/create-variation` with `{"contentId": "original-page-id", "variationName": "Variant B"}`. This creates a duplicate page as test variant that can be edited and published independently. End test: `POST /cms/v3/pages/{pageType}/ab-test/end` with `{"abTestId": "test-id", "winnerId": "winning-page-id"}`. Pages include `abTestId`, `abStatus` (MASTER, VARIANT, LOSER_VARIANT), and `mabExperimentId` properties for test management.

**Preview URLs enable review before publication.** Format varies by domain type: system domains (hs-sites.com, hubspotpagebuilder.com) require HubSpot login to view, while custom domains (Professional/Enterprise) are accessible without login. Preview URLs use `?hs_preview={token}` query parameter. Staged proof URLs in Content Staging (`your-domain.sandbox.hs-sites.com/page-slug`) are publicly accessible without login and not indexed by search engines—ideal for stakeholder review.

The **auto-save buffer system** operates independently in the UI. HubSpot maintains an auto-save buffer separate from saved drafts that updates continuously during editing. The buffer isn't exposed to standard API operations—it only copies to draft/live when users click "Save" or "Publish" in UI. API modifications bypass the auto-save buffer and work directly with draft/published versions. Advanced endpoints exist (`GET/PUT /cms/v3/pages/{objectId}/buffer`) but are not recommended for standard workflows.

## Critical limitations, gotchas, and risk mitigation

**HubSpot's most significant API limitation is the lack of partial update support for nested properties.** When you PATCH a page with `widgets`, `widgetContainers`, or `layoutSections`, the API doesn't merge your changes with existing content—it completely replaces the property with your payload. If the existing page has 5 widgets in a layoutSection and you PATCH with a layoutSection containing only 2 widgets, the other 3 are permanently deleted. This isn't a bug—it's documented behavior that requires the fetch-first pattern for all nested object updates.

The **template path gotcha** catches many developers: when setting `templatePath` in page creation or updates, do NOT include a leading slash. If you copy the path from Design Manager it shows `/templates/my-template.html`, but the API requires `templates/my-template.html`. Including the slash causes errors or unexpected behavior.

**State vs. currentState confusion** trips up blog post publishing. The `currentState` property is read-only and reflects current status. To change publication state, use the `state` property with values `DRAFT` or `PUBLISHED_OR_SCHEDULED`. Setting `currentState: "PUBLISHED"` in your PATCH payload won't publish the post—you must set `state: "PUBLISHED_OR_SCHEDULED"` or use the `/draft/push-live` endpoint.

**Empty layoutSections must be objects, not arrays.** Sending `layoutSections: []` causes errors. Use `layoutSections: {}` for pages without drag-and-drop areas. The layoutSections property is a keyed object where keys are area names defined in the template (like "dnd_area"), not a flat array.

**Widgets don't appear in API responses** if they haven't been edited from template defaults. The content object only stores overrides to template-defined widgets. To get full page content including template defaults, you must fetch both the page AND its template, then merge them. This makes "read all content" operations significantly more complex.

Rate limits create **operational boundaries that differ by endpoint**. The Search API's 5 requests/second limit is separate from and more restrictive than general burst limits of 100-250 per 10 seconds. OAuth apps get 110 per 10 seconds regardless of account tier and can't benefit from API Limit Increase add-ons. Each private app has its own burst limit bucket, but all share the daily limit pool.

**429 errors require exponential backoff with jitter.** Simple retry loops can create thundering herd problems when multiple processes hit rate limits simultaneously. Implement exponential backoff (2^retry * base_delay) with random jitter (±25% variation) to spread retries over time. Respect the `Retry-After` header when provided (in milliseconds).

**Template changes affect all pages using that template immediately**, even in Content Staging environments. If you modify a template file via Source Code API, every page using that template reflects the change instantly—there's no draft system for templates themselves. Mitigation: clone templates before editing them. Work on the clone, test thoroughly, then update pages to reference the new template path when ready.

**Drag-and-drop email templates have no API export/import.** Classic email templates support API operations, but modern drag-and-drop templates must be managed through the HubSpot UI. This limitation extends to certain modern page builders. Always verify API support exists before committing to an automation approach.

**File deletion via Source Code API is immediate and permanent** for published files. `DELETE /cms/v3/source-code/published/content/{path}` removes the file entirely with no confirmation. If live pages reference the deleted file, they break immediately. For draft environment, DELETE clears unpublished changes but doesn't remove published version. Always search for file references before deletion.

**Custom object limitations in HubL** create constraints for dynamic content. The `crm_objects()` function retrieves maximum 100 records per call with a hard limit of 300 records total using offset pagination (3 calls maximum). For larger datasets, you must use external server-side rendering or fetch data through client-side JavaScript, both of which complicate implementation.

**Multi-language content requires explicit setup.** Creating a language variant doesn't automatically duplicate content—it creates a new empty page/post linked to the primary. You must explicitly update the variant with translated content. The `translatedFromId` property links variants to primary, and the `translations` object maps language codes to variant IDs.

**Blog post filters use different syntax than pages** in subtle ways. Blog posts use double-underscore filters (`name__icontains=keyword`), while pages support this but also accept operator parameters. The inconsistency means code can't always be reused between content types without adjustment.

**Draft pages on system domains are invisible to non-logged-in users.** If you create drafts for review on hs-sites.com or hubspotpagebuilder.com domains, external stakeholders must be added as HubSpot users to view them. Content Staging's staged proof domain solves this by allowing unauthenticated preview access.

**Version history is read-only via API except for blog posts.** Only blog posts have a direct restore endpoint. Pages require the fetch-modify-update workaround. Neither provides a diff/comparison endpoint—you must implement client-side comparison logic by fetching two revision objects and comparing their JSON.

**Error messages are often vague.** A "Bad Request" error might indicate malformed multipart/form-data, a missing required property, an invalid property name, or a dozen other issues. The `message` field rarely provides actionable detail. Always capture the `correlationId` for support tickets—HubSpot's internal logs contain detailed error information keyed by this ID.

**Mixing legacy (v2) and modern (v3) APIs creates confusion.** Some documentation still references v2 endpoints while v3 has different behavior. V3 Files API made `access` property required where v2 had defaults. V3 Blog Posts API removed `campaign_name`, `is_draft`, `meta_keywords`, and renamed `topicIds` to `tagIds`. Always verify API version when following examples or documentation.

**Rate limit headers don't appear in Search API responses** despite Search API having its own separate rate limit. You must implement client-side tracking of Search API calls to avoid hitting the 5 requests/second limit. No server-side feedback is provided until you exceed the limit and receive 429 errors.

**OAuth refresh tokens can become invalid** when users uninstall apps, app scopes change after authorization, or tokens are revoked for security reasons. The error `BAD_REFRESH_TOKEN` or `invalid_grant` in refresh response means the user must re-authorize the app—stored refresh token is permanently invalid and cannot be recovered.

**Publishing to `published` environment in Source Code API clears draft.** When you `PUT /cms/v3/source-code/published/content/{path}`, it publishes immediately AND clears any pending draft changes. If someone was working on draft changes, those are lost. This behavior differs from page/post publish which preserves draft for future edits.

## Recommended MCP server tool design and implementation roadmap

### Phase 1: Foundation and safe operations (Weeks 1-3)

**Core infrastructure tools** form the foundation:

**1. `hubspot_authenticate`** - Validate connection and check permissions
- Input: None (uses environment variable for token)
- Output: Hub ID, user information, available scopes, rate limit status
- Implementation: `GET /oauth/v1/access-tokens/{token}` to validate
- Purpose: Health check before any operations

**2. `hubspot_list_blog_posts`** - Retrieve blog posts with filtering
- Inputs: `limit` (default 20), `offset` (default 0), `state` (DRAFT/PUBLISHED), `author_id`, `tag_ids`, `date_range`
- Output: Array of posts with id, name, slug, title, summary, state, publish_date, author
- Implementation: `GET /cms/v3/blogs/posts` with filter parameters
- Purpose: Discovery and selection for editing

**3. `hubspot_get_blog_post`** - Fetch complete blog post details
- Input: `post_id`
- Output: Full post object including content, metadata, tags, featured image
- Implementation: `GET /cms/v3/blogs/posts/{postId}`
- Purpose: Read current state before modifications

**4. `hubspot_update_blog_post_metadata`** - Safe metadata-only updates
- Inputs: `post_id`, `title`, `meta_description`, `slug`, `tags`, `author_id`, `featured_image_url`, `featured_image_alt`
- Output: Updated post object
- Implementation: Fetch current → modify metadata → `PATCH /draft` → return result
- Safety: Avoids content body, only touches structured metadata
- Purpose: AI-safe field editing without risk to content body

**5. `hubspot_publish_blog_post_draft`** - Explicit publishing action
- Input: `post_id`, optional `publish_date` for scheduling
- Output: Published post status
- Implementation: `POST /cms/v3/blogs/posts/{postId}/draft/push-live` or `/schedule`
- Purpose: Human-approved publication

**Phase 1 priorities:** These five tools enable Core Wrk to start managing their educational content series with AI assistance for metadata optimization (titles, descriptions, tags) while keeping actual content editing in the HubSpot UI. This hybrid approach maximizes safety while providing immediate value.

### Phase 2: Content creation and file management (Weeks 4-6)

**6. `hubspot_create_blog_post`** - Create new draft posts
- Inputs: `name`, `title`, `slug`, `content_body` (optional), `author_id`, `tag_ids`, `meta_description`, `summary`
- Output: Created post with draft state
- Implementation: `POST /cms/v3/blogs/posts` with `state: "DRAFT"`
- Purpose: AI-assisted content creation starting from draft

**7. `hubspot_update_blog_post_content`** - Modify post body content
- Inputs: `post_id`, `content_body` (HTML string), `summary`
- Output: Updated draft
- Implementation: Fetch current → modify postBody → `PATCH /draft` with full object
- Safety: Preview required before publishing
- Purpose: AI content generation and editing

**8. `hubspot_upload_file`** - Upload images and documents
- Inputs: `file_path` or `file_url`, `folder_path`, `access_level`, `file_name`
- Output: File URL for use in content
- Implementation: `POST /files/v3/files` with multipart/form-data
- Purpose: Asset management for AI-generated or selected images

**9. `hubspot_list_blog_tags`** - Retrieve and manage tags
- Inputs: `search_term` (optional)
- Output: Array of tags with id, name, slug
- Implementation: `GET /cms/v3/blogs/tags`
- Purpose: Tag selection for content categorization

**10. `hubspot_get_draft_preview_url`** - Generate preview links
- Input: `post_id` or `page_id`
- Output: Preview URL for review
- Implementation: Construct preview URL with domain + slug + preview token
- Purpose: Enable human review before publication

**Phase 2 priorities:** These tools enable end-to-end blog post creation with AI assistance, from drafting content through asset upload to preview generation. Still maintains human review checkpoint through preview URLs before publication.

### Phase 3: Page management and advanced features (Weeks 7-10)

**11. `hubspot_list_pages`** - Discover site and landing pages
- Inputs: `page_type` (site-pages/landing-pages), `state`, `template_path`, `domain`
- Output: Array of pages with id, name, slug, state, domain
- Implementation: `GET /cms/v3/pages/{pageType}`

**12. `hubspot_get_page`** - Retrieve page structure
- Input: `page_id`, `page_type`
- Output: Full page object (WARNING: includes complex nested structures)
- Implementation: `GET /cms/v3/pages/{pageType}/{objectId}`

**13. `hubspot_update_page_metadata`** - Safe page metadata updates
- Inputs: `page_id`, `page_type`, `title`, `meta_description`, `slug`
- Output: Updated page draft
- Implementation: Fetch → modify simple fields only → PATCH /draft
- Safety: Explicitly excludes layoutSections, widgets, widgetContainers
- Purpose: SEO optimization without layout risk

**14. `hubspot_list_templates`** - Discover available templates
- Output: Array of templates with id, path, label, type
- Implementation: `GET /cms/v3/source-code/draft/metadata/templates`

**15. `hubspot_create_page_from_template`** - Create new pages
- Inputs: `name`, `template_path`, `slug`, `domain`, `title`, `meta_description`
- Output: Created page in draft state
- Implementation: `POST /cms/v3/pages/site-pages` with minimal content

**Phase 3 priorities:** Pages introduce significantly more complexity through nested structures. These tools intentionally limit AI to metadata and new page creation from existing templates, avoiding the treacherous territory of layoutSection modification. For Core Wrk's homepage and landing pages, AI assists with SEO metadata while designers handle visual content through the HubSpot UI.

### Phase 4: Advanced content operations (Weeks 11-14)

**16. `hubspot_clone_content`** - Duplicate pages or posts for variations
- Inputs: `content_id`, `content_type`, `new_name`
- Output: Cloned content in draft state
- Implementation: `POST /cms/v3/{content-type}/clone`

**17. `hubspot_get_content_revisions`** - Access version history
- Input: `content_id`, `content_type`
- Output: Array of revisions with timestamps, users, change summaries
- Implementation: `GET /cms/v3/{content-type}/{id}/revisions`

**18. `hubspot_restore_revision`** - Rollback to previous version
- Inputs: `content_id`, `content_type`, `revision_id`
- Output: Restored content as draft
- Implementation: `POST /cms/v3/blogs/posts/{id}/revisions/{revisionId}/restore` or fetch-and-update pattern for pages

**19. `hubspot_bulk_update_metadata`** - Batch operations for multiple posts
- Inputs: `post_ids` array, `updates` object with metadata fields
- Output: Array of results with success/failure status
- Implementation: Iterate with rate limiting, fetch → modify → PATCH pattern for each
- Safety: Transaction-like behavior with rollback on failures

**20. `hubspot_search_content`** - Find content by text, metadata, or date
- Inputs: `query`, `content_type`, `date_range`, `state`, `limit`
- Output: Matching content items
- Implementation: Use filter syntax with contains operators
- Purpose: Content audit and bulk operation target selection

**Phase 4 priorities:** These power-user features enable sophisticated content management workflows, particularly valuable for Core Wrk's content series where AI might suggest metadata updates across related posts or help maintain content freshness through systematic review.

### Tool design principles across all phases

**1. Always draft-first:** Every modification creates or updates drafts, never touching live content directly. Separate explicit publish tools require confirmation.

**2. Fetch-before-update pattern:** All update tools internally fetch current state, apply modifications to the complete object, then PATCH. Never allow partial updates that could cause data loss.

**3. Explicit scope boundaries:** Each tool has a narrow, well-defined purpose. "Update metadata" tools explicitly exclude content body and nested structures to prevent accidents.

**4. Rate limit awareness:** All tools that might be called in succession include internal rate limiting and expose rate limit status in responses. Batch operations implement exponential backoff.

**5. Rich error context:** Failures return not just error messages but actionable guidance: "This operation requires scope X which is not available" or "Rate limit will reset in Y minutes, try again then."

**6. Preview before publish:** Tools that modify content return preview URLs. The MCP server can surface these to Claude, who can inform users to review before publishing.

**7. Rollback safety:** Critical update operations store the previous state and provide restoration paths if issues are detected post-publication.

### Authentication setup for Core Wrk

**Step 1: Create private app**
1. Navigate to Settings → Integrations → Private Apps
2. Click "Create a private app"
3. Name: "Core Wrk AI Content Editor"
4. Description: "MCP server enabling Claude to assist with blog and page management"

**Step 2: Configure scopes**
Select these scopes (minimum required):
- `content` - For pages and blog post management
- `files` - For image and document uploads
- `cms.domains.read` - For domain listing (helpful for URL construction)

Optional but recommended:
- `hubdb` - If using HubDB for dynamic content
- `cms.knowledge_base.articles.read` - If managing knowledge base content

**Step 3: Generate and secure token**
1. Click "Create app" and confirm
2. Go to Auth tab → "Show token" → "Copy"
3. Store in environment variable: `HUBSPOT_ACCESS_TOKEN=your_token_here`
4. **Never commit token to version control**
5. Add to .env file and .gitignore

**Step 4: Test connection**
```bash
curl https://api.hubapi.com/oauth/v1/access-tokens/YOUR_TOKEN \
  -H "Authorization: Bearer YOUR_TOKEN"
```
Should return Hub ID and granted scopes.

**Step 5: Set up token rotation reminder**
- Calendar event for 6 months from now: "Rotate HubSpot private app token"
- Document rotation procedure: Create new token, update environment variable, delete old token after verification

**Step 6: Configure rate limit monitoring**
- Set up monitoring to track `X-HubSpot-RateLimit-Remaining` header
- Alert when approaching 20% of daily limit
- Alert when burst limit drops below 20 requests remaining
- Log all 429 errors for analysis

## Core Wrk specific recommendations and workflow optimization

Core Wrk's use case centers on **educational content series, homepage updates, and landing page optimization**—all areas where the HubSpot CMS API provides strong support with appropriate guardrails. The educational content series benefits most from AI assistance in three specific workflows.

**Blog post creation workflow for educational series:**

1. Claude analyzes topic and target audience
2. Uses `hubspot_list_blog_tags` to discover relevant existing tags
3. Calls `hubspot_create_blog_post` with AI-generated outline, title, meta description, and selected tags
4. Returns draft post ID and preview URL
5. Human reviews and edits content in HubSpot UI (maintains visual control)
6. When approved, calls `hubspot_publish_blog_post_draft` with optional scheduling

This hybrid approach leverages AI for structure, SEO optimization, and consistency while keeping humans in control of detailed content and visual presentation. The draft-first pattern ensures no accidents affect live content.

**Homepage hero section updates workflow:**

Core Wrk's homepage likely uses a template with defined module areas. Rather than having AI modify complex layoutSections (high risk), the recommended pattern:

1. Claude suggests new hero section copy and CTA text
2. Uses `hubspot_update_page_metadata` to update meta tags for SEO
3. Generates preview URL showing the updated metadata
4. Returns suggestions as structured text: "Hero headline: [suggestion], CTA text: [suggestion]"
5. Human copies suggestions into HubSpot visual editor
6. Human publishes when satisfied

This workflow provides AI assistance without risking layout breaks. For more programmatic updates, Core Wrk could create a custom module with text fields for hero section, then AI could update module parameters—but this requires custom development beyond basic API usage.

**Landing page content optimization workflow:**

For Core Wrk's landing pages, AI excels at systematic optimization:

1. `hubspot_list_pages` with filter for landing page template
2. For each page: `hubspot_get_page` to retrieve current metadata
3. Analyze title, meta description, slug for SEO optimization
4. Use `hubspot_update_page_metadata` to apply improvements
5. Generate comparison showing old vs. new for human review
6. Bulk publish approved changes

This workflow enables AI to optimize dozens of landing pages for SEO consistency, keyword targeting, and character limits without touching page layouts.

**Content series management workflow:**

Core Wrk's educational content benefits from AI-assisted series organization:

1. `hubspot_search_content` to find all posts in a series (by tag or title pattern)
2. Analyze for consistency in structure, tags, internal linking
3. Identify gaps in series coverage or outdated content
4. Use `hubspot_bulk_update_metadata` to ensure consistent tagging
5. Suggest new posts to fill gaps in series
6. Generate interlink suggestions: "Post A should link to Post B in paragraph 3"

This transforms one-off content creation into systematic series development with AI maintaining consistency and identifying opportunities.

**Image asset management workflow:**

When creating content, Claude can:

1. Suggest image requirements: "Featured image should show [concept] in style [description]"
2. If provided with image files: `hubspot_upload_file` with PUBLIC_INDEXABLE access
3. Return HubSpot CDN URL
4. Include URL in blog post creation or update
5. Apply alt text optimization for accessibility and SEO

This streamlines asset handling, though actual image generation would happen external to HubSpot API.

**Metadata optimization at scale:**

Core Wrk can leverage AI for systematic metadata improvement:

1. Export all blog posts: `hubspot_list_blog_posts` with pagination to fetch all
2. Analyze each for meta description quality (length, keyword usage, clarity)
3. Generate improved meta descriptions following SEO best practices
4. Present batch of suggestions: "Update 47 posts with improved meta descriptions"
5. On approval: `hubspot_bulk_update_metadata` with rate limiting
6. Track results: posts updated, errors encountered, preview URLs for spot-check

This workflow addresses the common problem of inconsistent or missing metadata across large content libraries.

**Publishing calendar workflow:**

For coordinated content launches, Core Wrk can:

1. Claude helps plan content series with publication schedule
2. Create all posts as drafts: repeated `hubspot_create_blog_post` calls
3. Apply consistent metadata, tags, internal links across series
4. Schedule all posts: `hubspot_publish_blog_post_draft` with future `publish_date`
5. Generate summary: "Created 8-post series on [topic], publishing weekly from [date]"

This enables sophisticated editorial calendar management with AI assistance.

**Performance monitoring:** While HubSpot API doesn't provide analytics directly, Core Wrk should implement:

- Log all AI-assisted content modifications with timestamps
- Track which suggestions were accepted vs. rejected
- Monitor post-publication performance (external analytics)
- Refine AI prompts based on which generated content performs best
- A/B test AI-generated vs. human-written metadata

### Recommendations prioritized by value and safety

**Highest value, lowest risk (implement first):**
1. Blog post metadata optimization (titles, descriptions, tags)
2. New blog post creation with AI-generated outlines
3. File upload for featured images
4. Tag management and consistency

**Medium value, medium risk (implement with testing):**
5. Page metadata updates (SEO optimization)
6. Bulk metadata updates across content libraries
7. Content cloning for A/B test variations
8. Publishing schedule management

**Lower priority or higher risk (defer or implement with extra caution):**
9. Page layoutSection modifications (high risk, limited AI value)
10. Template modifications (affects all pages, high risk)
11. Direct live publishing without draft review (bypasses safety)
12. Automated content body generation (quality control concerns)

## Risk assessment and mitigation strategies

### High-severity risks

**Risk 1: Nested object data loss from partial updates**
- **Severity:** Critical
- **Likelihood:** High without proper implementation
- **Impact:** Permanent loss of page content, layout breaks, widgets deleted
- **Mitigation:**
  - Mandatory fetch-first pattern in all update tools
  - Never expose raw PATCH operations to AI
  - Implement tool-level validation that ensures complete object structures
  - Add pre-flight checks: "Draft has 5 widgets, update contains 5 widgets"
  - Log full before/after state for forensics
  - Maintain backup of previous state for emergency restoration

**Risk 2: Rate limit exhaustion causing service disruption**
- **Severity:** High
- **Likelihood:** Medium with bulk operations
- **Impact:** API access suspended, workflow halted, user frustration
- **Mitigation:**
  - Implement token bucket rate limiter shared across all tools
  - Expose rate limit status: "47% of daily limit used, 89 requests remaining in current window"
  - Queue operations when approaching limits rather than failing
  - Exponential backoff with jitter on 429 errors
  - Alert administrators at 80% daily limit consumption
  - Reserve 10% capacity for emergency operations

**Risk 3: Accidental live content modification**
- **Severity:** High (public-facing website impact)
- **Likelihood:** Low with proper tool design
- **Impact:** Live website breaks, user experience degraded, brand damage
- **Mitigation:**
  - No tools directly modify published content—always draft-first
  - Separate explicit publish tools requiring confirmation
  - Implement "preview before publish" workflow
  - Add safety prompts: "This will publish to live site serving 10k visitors/day. Confirm?"
  - Consider requiring manual HubSpot UI publication for high-traffic pages
  - Maintain emergency rollback procedure

### Medium-severity risks

**Risk 4: Template modifications affecting all pages**
- **Severity:** Medium-High
- **Likelihood:** Low (templates not in Phase 1-3)
- **Impact:** All pages using template affected simultaneously
- **Mitigation:**
  - Defer template editing tools to Phase 4
  - Clone template before any modifications
  - Test template changes on single page before broader use
  - Document which pages use which templates
  - Implement template change notifications

**Risk 5: Token exposure or compromise**
- **Severity:** Medium-High
- **Likelihood:** Low with proper practices
- **Impact:** Unauthorized API access, data breach, content manipulation
- **Mitigation:**
  - Store tokens only in environment variables or secure vaults
  - Never log token values
  - Implement token rotation every 6 months
  - Monitor for unusual API usage patterns
  - Revoke immediately if compromise suspected
  - Use separate tokens for development vs. production

**Risk 6: File upload failures or incorrect access levels**
- **Severity:** Medium
- **Likelihood:** Medium
- **Impact:** Broken images on live site, SEO impact from private files
- **Mitigation:**
  - Validate file uploads succeeded before referencing in content
  - Default to PUBLIC_INDEXABLE for content images
  - Verify uploaded file URL returns 200 before publishing content
  - Implement retry logic for failed uploads
  - Maintain local backup of uploaded files

### Lower-severity risks

**Risk 7: Inconsistent metadata across content**
- **Severity:** Low
- **Likelihood:** Medium without AI assistance
- **Impact:** SEO performance reduced, user experience inconsistent
- **Mitigation:**
  - Use AI to audit metadata systematically
  - Define metadata standards and validate against them
  - Regular metadata audits across content library
  - Templates for consistent metadata generation

**Risk 8: Preview URL sharing exposing draft content**
- **Severity:** Low
- **Likelihood:** Medium
- **Impact:** Unfinished content seen by unintended audiences
- **Mitigation:**
  - Educate users that preview URLs on custom domains are public
  - Consider using Content Staging for sensitive launches
  - Document preview URL sharing policies
  - Use scheduled publishing for coordinated reveals

**Risk 9: API version deprecation or breaking changes**
- **Severity:** Low-Medium
- **Likelihood:** Low (HubSpot provides advance notice)
- **Impact:** Tools break, require updates
- **Mitigation:**
  - Monitor HubSpot Developer Changelog
  - Use v3 APIs (current, stable)
  - Implement graceful degradation for API failures
  - Maintain backward compatibility testing
  - Version MCP server tools to track API dependencies

### Emergency procedures

**Procedure 1: Content disaster recovery**
If published content is broken:
1. Immediately use `hubspot_get_content_revisions` to fetch revision history
2. Identify last known-good version
3. Use `hubspot_restore_revision` or manual restoration via fetch-and-update
4. Push restored version live: `hubspot_publish_draft`
5. Verify restoration in browser
6. Document what went wrong and update tools to prevent recurrence

**Procedure 2: Rate limit emergency**
If rate limits exhausted during critical operation:
1. Queue remaining operations
2. Calculate time until limit reset (daily resets at midnight in account timezone)
3. Implement manual emergency procedure through HubSpot UI if time-critical
4. Analyze what caused excessive API usage
5. Implement stricter rate limiting for future operations
6. Consider purchasing API Limit Increase if regular concern

**Procedure 3: Token compromise**
If access token potentially exposed:
1. Immediately rotate token in HubSpot private app settings
2. Use 7-day rotation period to update all systems
3. Monitor API usage during rotation period for unauthorized activity
4. Audit all content modifications in timeframe of potential compromise
5. Review and restore any unauthorized changes via version history
6. Strengthen token storage practices

This comprehensive research provides the complete foundation for building a production-ready MCP server that enables Claude to safely assist with HubSpot CMS content management. The key to success lies in embracing HubSpot's draft-first architecture, respecting the no-partial-updates constraint, and maintaining humans in the approval loop for publication decisions.