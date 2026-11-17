use sea_orm_migration::prelude::*;
pub struct Migration;
impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20261112_000122_customer_instance_delivery"
    }
}
#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.get_connection().execute_unprepared(
            "CREATE TABLE instance_delivery_state (key TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES iam_users(id), instance_id TEXT, provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW());"
        ).await?;
        Ok(())
    }
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("DROP TABLE instance_delivery_state")
            .await?;
        Ok(())
    }
}
