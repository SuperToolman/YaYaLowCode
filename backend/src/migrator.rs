pub use sea_orm_migration::prelude::*;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260626_000001_create_apps_table::Migration),
            Box::new(m20260626_000002_create_form_definitions_table::Migration),
            Box::new(m20260626_000003_create_form_schemas_table::Migration),
            Box::new(m20260626_000004_create_app_navigation_items_table::Migration),
            Box::new(m20260626_000005_create_form_records_table::Migration),
        ]
    }
}

mod m20260626_000001_create_apps_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .create_table(
                    Table::create()
                        .table(Apps::Table)
                        .if_not_exists()
                        .col(ColumnDef::new(Apps::Id).uuid().not_null().primary_key())
                        .col(
                            ColumnDef::new(Apps::RouteAppId)
                                .string_len(32)
                                .not_null()
                                .unique_key(),
                        )
                        .col(ColumnDef::new(Apps::Name).string_len(120).not_null())
                        .col(ColumnDef::new(Apps::Description).string_len(255).not_null())
                        .col(ColumnDef::new(Apps::Icon).string_len(32).not_null())
                        .col(ColumnDef::new(Apps::Badge).string_len(32).null())
                        .col(ColumnDef::new(Apps::Color).string_len(96).not_null())
                        .col(ColumnDef::new(Apps::Status).string_len(24).not_null())
                        .col(ColumnDef::new(Apps::OwnerName).string_len(80).not_null())
                        .col(
                            ColumnDef::new(Apps::RecordsCount)
                                .big_integer()
                                .not_null()
                                .default(0),
                        )
                        .col(
                            ColumnDef::new(Apps::CreatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(Apps::UpdatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-apps-created-at")
                        .table(Apps::Table)
                        .col(Apps::CreatedAt)
                        .to_owned(),
                )
                .await
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .drop_table(Table::drop().table(Apps::Table).to_owned())
                .await
        }
    }

    #[derive(DeriveIden)]
    enum Apps {
        Table,
        Id,
        RouteAppId,
        Name,
        Description,
        Icon,
        Badge,
        Color,
        Status,
        OwnerName,
        RecordsCount,
        CreatedAt,
        UpdatedAt,
    }
}

mod m20260626_000002_create_form_definitions_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .create_table(
                    Table::create()
                        .table(FormDefinitions::Table)
                        .if_not_exists()
                        .col(
                            ColumnDef::new(FormDefinitions::Id)
                                .uuid()
                                .not_null()
                                .primary_key(),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::AppRouteAppId)
                                .string_len(32)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::FormUuid)
                                .string_len(40)
                                .not_null()
                                .unique_key(),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::Name)
                                .string_len(120)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::Slug)
                                .string_len(80)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::Status)
                                .string_len(24)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::DraftSchemaVersion)
                                .integer()
                                .not_null()
                                .default(1),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::PublishedSchemaVersion)
                                .integer()
                                .not_null()
                                .default(1),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::LatestSchemaVersion)
                                .integer()
                                .not_null()
                                .default(1),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::CreatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::UpdatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-form-definitions-app-route-app-id")
                        .table(FormDefinitions::Table)
                        .col(FormDefinitions::AppRouteAppId)
                        .to_owned(),
                )
                .await
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .drop_table(Table::drop().table(FormDefinitions::Table).to_owned())
                .await
        }
    }

    #[derive(DeriveIden)]
    enum FormDefinitions {
        Table,
        Id,
        AppRouteAppId,
        FormUuid,
        Name,
        Slug,
        Status,
        DraftSchemaVersion,
        PublishedSchemaVersion,
        LatestSchemaVersion,
        CreatedAt,
        UpdatedAt,
    }
}

mod m20260626_000003_create_form_schemas_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .create_table(
                    Table::create()
                        .table(FormSchemas::Table)
                        .if_not_exists()
                        .col(
                            ColumnDef::new(FormSchemas::Id)
                                .uuid()
                                .not_null()
                                .primary_key(),
                        )
                        .col(
                            ColumnDef::new(FormSchemas::FormUuid)
                                .string_len(40)
                                .not_null(),
                        )
                        .col(ColumnDef::new(FormSchemas::Version).integer().not_null())
                        .col(
                            ColumnDef::new(FormSchemas::SchemaJson)
                                .json_binary()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormSchemas::ChangeLog)
                                .string_len(255)
                                .null(),
                        )
                        .col(
                            ColumnDef::new(FormSchemas::Published)
                                .boolean()
                                .not_null()
                                .default(false),
                        )
                        .col(
                            ColumnDef::new(FormSchemas::CreatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormSchemas::UpdatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-form-schemas-form-uuid-version")
                        .table(FormSchemas::Table)
                        .col(FormSchemas::FormUuid)
                        .col(FormSchemas::Version)
                        .unique()
                        .to_owned(),
                )
                .await
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .drop_table(Table::drop().table(FormSchemas::Table).to_owned())
                .await
        }
    }

    #[derive(DeriveIden)]
    enum FormSchemas {
        Table,
        Id,
        FormUuid,
        Version,
        SchemaJson,
        ChangeLog,
        Published,
        CreatedAt,
        UpdatedAt,
    }
}

mod m20260626_000004_create_app_navigation_items_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .create_table(
                    Table::create()
                        .table(AppNavigationItems::Table)
                        .if_not_exists()
                        .col(
                            ColumnDef::new(AppNavigationItems::Id)
                                .uuid()
                                .not_null()
                                .primary_key(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::AppRouteAppId)
                                .string_len(32)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::ItemType)
                                .string_len(24)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::TargetFormUuid)
                                .string_len(40)
                                .null(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::Title)
                                .string_len(120)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::PathSlug)
                                .string_len(80)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::SortOrder)
                                .integer()
                                .not_null()
                                .default(0),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::IsDefaultEntry)
                                .boolean()
                                .not_null()
                                .default(false),
                        )
                        .col(ColumnDef::new(AppNavigationItems::ParentId).uuid().null())
                        .col(
                            ColumnDef::new(AppNavigationItems::VisibilityRule)
                                .string_len(255)
                                .null(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::CreatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::UpdatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-app-navigation-items-app-route-app-id")
                        .table(AppNavigationItems::Table)
                        .col(AppNavigationItems::AppRouteAppId)
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-app-navigation-items-default-entry")
                        .table(AppNavigationItems::Table)
                        .col(AppNavigationItems::AppRouteAppId)
                        .col(AppNavigationItems::IsDefaultEntry)
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("uidx-app-navigation-items-target-form-uuid")
                        .table(AppNavigationItems::Table)
                        .col(AppNavigationItems::TargetFormUuid)
                        .unique()
                        .to_owned(),
                )
                .await
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .drop_table(Table::drop().table(AppNavigationItems::Table).to_owned())
                .await
        }
    }

    #[derive(DeriveIden)]
    enum AppNavigationItems {
        Table,
        Id,
        AppRouteAppId,
        ItemType,
        TargetFormUuid,
        Title,
        PathSlug,
        SortOrder,
        IsDefaultEntry,
        ParentId,
        VisibilityRule,
        CreatedAt,
        UpdatedAt,
    }
}

mod m20260626_000005_create_form_records_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .create_table(
                    Table::create()
                        .table(FormRecords::Table)
                        .if_not_exists()
                        .col(
                            ColumnDef::new(FormRecords::Id)
                                .uuid()
                                .not_null()
                                .primary_key(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::RecordUuid)
                                .string_len(40)
                                .not_null()
                                .unique_key(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::AppRouteAppId)
                                .string_len(32)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::FormUuid)
                                .string_len(40)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::SchemaVersion)
                                .integer()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::RecordData)
                                .json_binary()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::CreatedBy)
                                .string_len(80)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::UpdatedBy)
                                .string_len(80)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::CreatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::UpdatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-form-records-form-uuid-created-at")
                        .table(FormRecords::Table)
                        .col(FormRecords::FormUuid)
                        .col(FormRecords::CreatedAt)
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-form-records-app-route-app-id")
                        .table(FormRecords::Table)
                        .col(FormRecords::AppRouteAppId)
                        .to_owned(),
                )
                .await
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .drop_table(Table::drop().table(FormRecords::Table).to_owned())
                .await
        }
    }

    #[derive(DeriveIden)]
    enum FormRecords {
        Table,
        Id,
        RecordUuid,
        AppRouteAppId,
        FormUuid,
        SchemaVersion,
        RecordData,
        CreatedBy,
        UpdatedBy,
        CreatedAt,
        UpdatedAt,
    }
}
