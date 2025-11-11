/**
 * Type definitions for HubSpot CMS MCP Server
 */

export interface HubSpotConfig {
  accessToken: string;
  rateLimitSafetyMargin: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface RateLimitStatus {
  dailyRemaining: number;
  burstRemaining: number;
  dailyPercentUsed: number;
  burstPercentUsed: number;
}

export interface HubSpotError {
  status: string;
  message: string;
  correlationId: string;
  category?: string;
  subCategory?: string;
  errors?: Array<{
    message: string;
    in?: string;
  }>;
}

export interface HubSpotResponse<T> {
  success: boolean;
  data?: T;
  error?: HubSpotError;
  rateLimitStatus?: RateLimitStatus;
}

export interface TokenValidationResponse {
  token: string;
  user: string;
  hub_domain: string;
  hub_id: number;
  app_id: number;
  expires_at: number;
  user_id: number;
  token_type: string;
  scopes: string[];
}

export interface BlogPost {
  id: string;
  name: string;
  slug: string;
  state: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED';
  currentState?: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED';
  postBody?: string;
  postSummary?: string;
  metaDescription?: string;
  featuredImage?: string;
  featuredImageAltText?: string;
  authorName?: string;
  blogAuthorId?: string;
  tagIds?: number[];
  publishDate?: string;
  created?: string;
  updated?: string;
  url?: string;
  previewKey?: string;
  htmlTitle?: string;
  pageExpiryEnabled?: boolean;
  pageExpiryDate?: number;
  pageExpiryRedirectUrl?: string;
  absoluteUrl?: string;
  archivedInDashboard?: boolean;
  currentlyPublished?: boolean;
  publicAccessRulesEnabled?: boolean;
  publicAccessRules?: any[];
  widgetContainers?: any;
  widgets?: any;
  layoutSections?: any;
}

export interface BlogPostListParams {
  limit?: number;
  offset?: number;
  state?: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED';
  authorName?: string;
  name?: string;
  created?: string;
  updated?: string;
  archivedInDashboard?: boolean;
}

export interface PaginatedResponse<T> {
  total: number;
  results: T[];
  offset?: number;
  limit?: number;
}

export interface BlogPostUpdateMetadata {
  name?: string;
  slug?: string;
  metaDescription?: string;
  htmlTitle?: string;
  featuredImage?: string;
  featuredImageAltText?: string;
  blogAuthorId?: string;
  authorName?: string;
  tagIds?: number[];
}

export interface PublishOptions {
  publishDate?: string; // ISO 8601 format for scheduled publishing
}

export interface OperationResult {
  success: boolean;
  contentId?: string;
  previewUrl?: string;
  message: string;
  rateLimitStatus: RateLimitStatus;
  timestamp: string;
}

// Phase 2: Content creation and file management types

export interface BlogPostCreateParams {
  name: string;  // Internal name for the post
  slug: string;  // URL slug
  contentGroupId?: string;  // Blog ID (optional, will use default if not specified)
  blogAuthorId?: string;  // Author ID
  htmlTitle?: string;  // SEO title
  postBody?: string;  // HTML content (optional for initial creation)
  postSummary?: string;  // Brief summary for listings
  metaDescription?: string;  // Meta description
  tagIds?: number[];  // Array of tag IDs
  featuredImage?: string;  // Featured image URL
  featuredImageAltText?: string;  // Featured image alt text
}

export interface BlogPostContentUpdate {
  postBody: string;  // HTML content
  postSummary?: string;  // Brief summary
}

export interface FileUploadParams {
  fileContent: string;  // Base64 encoded file content or URL
  fileName: string;  // Name of the file
  folderPath?: string;  // Folder path in HubSpot (e.g., "/images/blog")
  access?: 'PUBLIC_INDEXABLE' | 'PUBLIC_NOT_INDEXABLE' | 'PRIVATE';
  ttl?: string;  // Time to live (e.g., "P3M" for 3 months)
}

export interface FileUploadResponse {
  id: string;
  url: string;  // CDN URL of the uploaded file
  name: string;
  path: string;
  type: string;
  size: number;
}

export interface BlogTag {
  id: number;
  name: string;
  slug: string;
  created?: string;
  updated?: string;
}

export interface PreviewUrlParams {
  contentId: string;
  contentType: 'blog-post' | 'site-page' | 'landing-page';
}

// Phase 3: Page management and advanced features types

export interface Page {
  id: string;
  name: string;
  slug: string;
  state: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED';
  currentState?: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED';
  htmlTitle?: string;
  metaDescription?: string;
  domain?: string;
  url?: string;
  absoluteUrl?: string;
  previewKey?: string;
  created?: string;
  updated?: string;
  publishDate?: string;
  templatePath?: string;
  currentlyPublished?: boolean;
  archivedInDashboard?: boolean;
  // Nested content structures - handled carefully
  widgets?: any;
  widgetContainers?: any;
  layoutSections?: any;
}

export interface PageListParams {
  pageType: 'site-pages' | 'landing-pages';
  limit?: number;
  offset?: number;
  state?: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED';
  templatePath?: string;
  domain?: string;
  name?: string;
  created?: string;
  updated?: string;
  archivedInDashboard?: boolean;
}

export interface PageUpdateMetadata {
  name?: string;
  slug?: string;
  htmlTitle?: string;
  metaDescription?: string;
  // Explicitly exclude nested structures for safety
}

export interface Template {
  id: string;
  path: string;
  label?: string;
  type?: string;
  isAvailableForNewContent?: boolean;
}

export interface PageCreateParams {
  name: string;  // Internal name for the page
  slug: string;  // URL slug
  templatePath: string;  // Path to template (without leading slash)
  domain?: string;  // Domain to publish to
  htmlTitle?: string;  // HTML title tag
  metaDescription?: string;  // Meta description
}

// Phase 5: Safe webpage content and appearance editing types

export interface Widget {
  id: string;
  name: string;
  type: string;
  body?: {
    html?: string;
    [key: string]: any;
  };
  params?: {
    [key: string]: any;
  };
  styles?: {
    [key: string]: any;
  };
  [key: string]: any;
}

export interface WidgetLocation {
  sectionName: string;  // e.g., "dnd_area"
  rowIndex: number;
  columnIndex: number;
  widgetIndex: number;
}

export interface PageContentStructure {
  pageId: string;
  pageName: string;
  widgets: Array<{
    id: string;
    name: string;
    type: string;
    location: WidgetLocation;
    hasHtmlContent: boolean;
    hasStyles: boolean;
    hasParams: boolean;
    contentPreview?: string;
  }>;
  layoutSections: string[];  // Names of layout sections in the page
  totalWidgets: number;
}

export interface WidgetUpdateParams {
  pageId: string;
  pageType: 'site-pages' | 'landing-pages';
  location: WidgetLocation;
  html?: string;  // Update HTML content
  styles?: { [key: string]: any };  // Update styles
  params?: { [key: string]: any };  // Update module parameters
}

export interface WidgetAddParams {
  pageId: string;
  pageType: 'site-pages' | 'landing-pages';
  location: Omit<WidgetLocation, 'widgetIndex'>;  // Don't need widgetIndex for adding
  widgetType: string;
  widgetName: string;
  html?: string;
  params?: { [key: string]: any };
  styles?: { [key: string]: any };
}

export interface WidgetRemoveParams {
  pageId: string;
  pageType: 'site-pages' | 'landing-pages';
  location: WidgetLocation;
}

export interface WidgetReorderParams {
  pageId: string;
  pageType: 'site-pages' | 'landing-pages';
  fromLocation: WidgetLocation;
  toLocation: WidgetLocation;
}

export interface PageContentUpdate {
  widgets?: any;
  widgetContainers?: any;
  layoutSections?: any;
}

export interface StructuralValidation {
  isValid: boolean;
  beforeWidgetCount: number;
  afterWidgetCount: number;
  beforeSectionCount: number;
  afterSectionCount: number;
  warnings: string[];
  errors: string[];
}
