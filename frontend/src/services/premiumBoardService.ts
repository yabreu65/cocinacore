import {
  PremiumRecipeDetailDto,
  PremiumRecipeDto,
  PremiumRecipePublishInput,
  PremiumRecipePublishResult,
  PremiumRecipeReportInput,
  PremiumRecipeReportResult,
  PremiumRecipeReviewInput,
  PremiumRecipeReviewResult,
  PremiumRecipeWithdrawInput,
  PremiumRecipeWithdrawResult,
} from './types';

export interface PremiumBoardError {
  message: string;
  code?: string;
}

export interface PremiumBoardResult<T> {
  data: T | null;
  error: PremiumBoardError | null;
}

type Result<T> = Promise<PremiumBoardResult<T>>;

export interface PremiumRecipeInsertRow {
  source_recipe_history_id: string;
  source_tenant_id: string;
  creator_user_id: string;
  creator_display_name: string | null;
  eligibility_score: number;
  creator_opted_in: boolean;
  status: 'published';
  published_at: string;
}

export interface PremiumRecipeReviewUpsertRow {
  premium_recipe_id: string;
  user_id: string;
  stars: 1 | 2 | 3 | 4 | 5;
  comment: string | null;
  updated_at: string;
}

export interface PremiumReviewReportInsertRow {
  premium_recipe_id: string;
  review_id: string | null;
  reporter_user_id: string;
  reason: string;
}

export interface PremiumRecipeUpdateRow {
  status: 'withdrawn';
  withdrawn_at: string;
  updated_at: string;
}

export interface PremiumRecipesSelectBuilder {
  insert(values: PremiumRecipeInsertRow[]): {
    select(columns: '*'): {
      single(): Result<PremiumRecipeDto>;
    };
  };
  update(values: PremiumRecipeUpdateRow): {
    eq(
      column: 'id',
      value: string
    ): {
      eq(
        column: 'creator_user_id',
        value: string
      ): {
        select(columns: '*'): {
          single(): Result<PremiumRecipeDto>;
        };
      };
    };
  };
  select(columns: string): {
    eq(
      column: 'id',
      value: string
    ): {
      maybeSingle(): Result<PremiumRecipeDetailDto>;
    };
  };
}

export interface PremiumRecipeReviewsTable {
  upsert(
    values: PremiumRecipeReviewUpsertRow[],
    options: { onConflict: 'premium_recipe_id,user_id' }
  ): {
    select(columns: '*'): {
      single(): Result<PremiumRecipeReviewResult>;
    };
  };
}

export interface PremiumReviewReportsTable {
  insert(values: PremiumReviewReportInsertRow[]): {
    select(columns: '*'): {
      single(): Result<PremiumRecipeReportResult>;
    };
  };
}

export interface PremiumBoardClientLike {
  from(tableName: 'premium_recipes'): PremiumRecipesSelectBuilder;
  from(tableName: 'premium_recipe_reviews'): PremiumRecipeReviewsTable;
  from(tableName: 'premium_review_reports'): PremiumReviewReportsTable;
}

export class PremiumBoardService {
  constructor(private readonly client: PremiumBoardClientLike) {}

  async publishRecipe(
    input: PremiumRecipePublishInput
  ): Promise<PremiumBoardResult<PremiumRecipePublishResult>> {
    const publishedAt = new Date().toISOString();

    return this.client
      .from('premium_recipes')
      .insert([
        {
          source_recipe_history_id: input.sourceRecipeHistoryId,
          source_tenant_id: input.sourceTenantId,
          creator_user_id: input.creatorUserId,
          creator_display_name: input.attribution.displayName,
          eligibility_score: input.eligibilityScore,
          creator_opted_in: input.creatorOptIn,
          status: 'published',
          published_at: publishedAt,
        },
      ])
      .select('*')
      .single();
  }

  async submitOrUpdateReview(
    input: PremiumRecipeReviewInput
  ): Promise<PremiumBoardResult<PremiumRecipeReviewResult>> {
    return this.client
      .from('premium_recipe_reviews')
      .upsert(
        [
          {
            premium_recipe_id: input.premiumRecipeId,
            user_id: input.userId,
            stars: input.stars,
            comment: input.comment ?? null,
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'premium_recipe_id,user_id' }
      )
      .select('*')
      .single();
  }

  async reportRecipeOrReview(
    input: PremiumRecipeReportInput
  ): Promise<PremiumBoardResult<PremiumRecipeReportResult>> {
    return this.client
      .from('premium_review_reports')
      .insert([
        {
          premium_recipe_id: input.premiumRecipeId,
          review_id: input.reviewId ?? null,
          reporter_user_id: input.reporterUserId,
          reason: input.reason,
        },
      ])
      .select('*')
      .single();
  }

  async withdrawRecipe(
    input: PremiumRecipeWithdrawInput
  ): Promise<PremiumBoardResult<PremiumRecipeWithdrawResult>> {
    return this.client
      .from('premium_recipes')
      .update({
        status: 'withdrawn',
        withdrawn_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.premiumRecipeId)
      .eq('creator_user_id', input.creatorUserId)
      .select('*')
      .single();
  }

  async getRecipeDetail(recipeId: string): Promise<PremiumBoardResult<PremiumRecipeDetailDto>> {
    return this.client.from('premium_recipes').select('*').eq('id', recipeId).maybeSingle();
  }
}
