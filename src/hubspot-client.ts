/**
 * HubSpot API Client with comprehensive error handling and rate limiting
 */

import {
  HubSpotConfig,
  HubSpotResponse,
  HubSpotError,
  TokenValidationResponse,
  BlogPost,
  BlogPostListParams,
  PaginatedResponse,
  BlogPostUpdateMetadata,
  PublishOptions
} from './types.js';
import { RateLimiter } from './rate-limiter.js';
import { logger } from './logger.js';

export class HubSpotClient {
  private config: HubSpotConfig;
  private rateLimiter: RateLimiter;
  private baseUrl = 'https://api.hubapi.com';
  private maxRetries = 4;

  constructor(config: HubSpotConfig) {
    this.config = config;
    this.rateLimiter = new RateLimiter(config.rateLimitSafetyMargin);
  }

  /**
   * Make an HTTP request to HubSpot API with error handling and retries
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    attempt: number = 0
  ): Promise<HubSpotResponse<T>> {
    // Check rate limits before making request
    if (!this.rateLimiter.canMakeRequest()) {
      return {
        success: false,
        error: {
          status: 'RATE_LIMIT_SAFETY',
          message: 'Approaching rate limit threshold. Request blocked by safety margin.',
          correlationId: 'N/A'
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${this.config.accessToken}`);
    headers.set('Content-Type', 'application/json');

    logger.debug(`Request: ${options.method || 'GET'} ${endpoint}`, {
      attempt,
      body: options.body
    });

    try {
      this.rateLimiter.recordRequest();

      const response = await fetch(url, {
        ...options,
        headers
      });

      // Update rate limits from response headers
      this.rateLimiter.updateFromHeaders(response.headers);

      // Handle rate limiting with exponential backoff
      if (response.status === 429 && attempt < this.maxRetries) {
        const delay = this.rateLimiter.calculateBackoff(attempt);
        logger.warn(`Rate limited, retrying after ${delay}ms`, { attempt });
        await this.sleep(delay);
        return this.request<T>(endpoint, options, attempt + 1);
      }

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = this.parseError(response, responseData);
        logger.error('API request failed', { endpoint, error });

        return {
          success: false,
          error,
          rateLimitStatus: this.rateLimiter.getStatus()
        };
      }

      logger.debug('Request successful', { endpoint, status: response.status });

      return {
        success: true,
        data: responseData as T,
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    } catch (error) {
      // Handle network errors with retry
      if (attempt < this.maxRetries) {
        const delay = this.rateLimiter.calculateBackoff(attempt);
        logger.warn(`Network error, retrying after ${delay}ms`, { attempt, error });
        await this.sleep(delay);
        return this.request<T>(endpoint, options, attempt + 1);
      }

      logger.error('Request failed after retries', { endpoint, error });

      return {
        success: false,
        error: {
          status: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Unknown network error',
          correlationId: 'N/A'
        },
        rateLimitStatus: this.rateLimiter.getStatus()
      };
    }
  }

  /**
   * Parse HubSpot error response into user-friendly format
   */
  private parseError(response: Response, data: any): HubSpotError {
    const correlationId = response.headers.get('X-HubSpot-Correlation-Id') || 'N/A';

    // Handle common error formats
    if (data.message) {
      return {
        status: data.status || response.statusText,
        message: this.makeFriendlyErrorMessage(response.status, data.message),
        correlationId,
        category: data.category,
        subCategory: data.subCategory,
        errors: data.errors
      };
    }

    // Fallback for unknown error format
    return {
      status: response.statusText,
      message: this.makeFriendlyErrorMessage(response.status, 'Unknown error occurred'),
      correlationId
    };
  }

  /**
   * Convert technical errors to user-friendly messages
   */
  private makeFriendlyErrorMessage(status: number, message: string): string {
    switch (status) {
      case 401:
        return 'Authentication failed. Please check your HUBSPOT_ACCESS_TOKEN is valid and not expired.';
      case 403:
        return `Permission denied. Your access token may be missing required scopes. Original error: ${message}`;
      case 404:
        return `Resource not found. The requested content may have been deleted or the ID is incorrect. Original error: ${message}`;
      case 429:
        return 'Rate limit exceeded. Please wait before making more requests.';
      case 500:
      case 502:
      case 503:
        return `HubSpot service error. Please try again later. Original error: ${message}`;
      default:
        return message;
    }
  }

  /**
   * Sleep helper for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate token and get connection information
   */
  async validateToken(): Promise<HubSpotResponse<TokenValidationResponse>> {
    // Extract token from Bearer format if needed
    const token = this.config.accessToken.replace('Bearer ', '');
    return this.request<TokenValidationResponse>(
      `/oauth/v1/access-tokens/${token}`,
      { method: 'GET' }
    );
  }

  /**
   * List blog posts with filtering and pagination
   */
  async listBlogPosts(
    params: BlogPostListParams = {}
  ): Promise<HubSpotResponse<PaginatedResponse<BlogPost>>> {
    const queryParams = new URLSearchParams();

    // Add pagination
    if (params.limit) queryParams.set('limit', Math.min(params.limit, 100).toString());
    if (params.offset) queryParams.set('offset', params.offset.toString());

    // Add filters using double-underscore syntax
    if (params.state) queryParams.set('state', params.state);
    if (params.authorName) queryParams.set('authorName__icontains', params.authorName);
    if (params.name) queryParams.set('name__icontains', params.name);
    if (params.created) queryParams.set('created__gt', params.created);
    if (params.updated) queryParams.set('updated__gt', params.updated);
    if (params.archivedInDashboard !== undefined) {
      queryParams.set('archivedInDashboard', params.archivedInDashboard.toString());
    }

    const endpoint = `/cms/v3/blogs/posts?${queryParams.toString()}`;
    return this.request<PaginatedResponse<BlogPost>>(endpoint, { method: 'GET' });
  }

  /**
   * Get complete blog post details
   */
  async getBlogPost(postId: string): Promise<HubSpotResponse<BlogPost>> {
    logger.info('Fetching blog post', { postId });
    return this.request<BlogPost>(`/cms/v3/blogs/posts/${postId}`, { method: 'GET' });
  }

  /**
   * Update blog post metadata using fetch-first pattern
   * CRITICAL: This never modifies postBody to prevent data loss
   */
  async updateBlogPostMetadata(
    postId: string,
    metadata: BlogPostUpdateMetadata
  ): Promise<HubSpotResponse<BlogPost>> {
    const opId = logger.getNextOperationId();
    logger.info('Starting metadata update with fetch-first pattern', { opId, postId });

    // STEP 1: Fetch current state
    const currentResponse = await this.getBlogPost(postId);
    if (!currentResponse.success || !currentResponse.data) {
      logger.error('Failed to fetch current state', { opId, postId });
      return currentResponse;
    }

    const beforeState = currentResponse.data;
    logger.info('Fetched current state', { opId, postId });

    // STEP 2: Merge metadata (explicitly exclude postBody)
    const updatedPost = {
      ...beforeState,
      ...metadata,
      // Ensure we never touch the post body
      postBody: beforeState.postBody,
      // Preserve critical nested structures
      widgets: beforeState.widgets,
      widgetContainers: beforeState.widgetContainers,
      layoutSections: beforeState.layoutSections
    };

    // STEP 3: PATCH to draft endpoint
    logger.info('Updating draft with merged data', { opId, postId });
    const response = await this.request<BlogPost>(
      `/cms/v3/blogs/posts/${postId}/draft`,
      {
        method: 'PATCH',
        body: JSON.stringify(updatedPost)
      }
    );

    if (response.success) {
      logger.logOperation(
        'update_blog_post_metadata',
        { opId, postId, metadata },
        beforeState,
        response.data
      );
    }

    return response;
  }

  /**
   * Publish a blog post draft
   * Can publish immediately or schedule for future date
   */
  async publishBlogPostDraft(
    postId: string,
    options: PublishOptions = {}
  ): Promise<HubSpotResponse<BlogPost>> {
    const opId = logger.getNextOperationId();
    logger.info('Publishing blog post draft', { opId, postId, options });

    // Fetch current draft state for audit log
    const currentResponse = await this.getBlogPost(postId);
    const beforeState = currentResponse.success ? currentResponse.data : undefined;

    const body: any = {};

    // Add scheduled publishing date if provided
    if (options.publishDate) {
      body.publishDate = options.publishDate;
    }

    const response = await this.request<BlogPost>(
      `/cms/v3/blogs/posts/${postId}/draft/push-live`,
      {
        method: 'POST',
        body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined
      }
    );

    if (response.success) {
      logger.logOperation(
        'publish_blog_post',
        { opId, postId, options },
        beforeState,
        response.data
      );
    }

    return response;
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus() {
    return this.rateLimiter.getStatus();
  }
}
