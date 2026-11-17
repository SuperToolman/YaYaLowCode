//! One-time customer administrator provisioning. Environment is delivery input,
//! never a mechanism for overwriting an already provisioned customer's identity.
use crate::platform::error::AppError;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement, TransactionTrait};

pub(crate) fn normalize_mobile(value: &str) -> Result<String, AppError> {
    let phone = value.trim().replace([' ', '-'], "");
    let phone = phone.strip_prefix("+86").unwrap_or(&phone);
    if !regex::Regex::new(r"^1[3-9][0-9]{9}$")
        .unwrap()
        .is_match(phone)
    {
        return Err(AppError::BadRequest(
            "YAYA_PLATFORM_ADMIN_MOBILE 必须为有效中国大陆手机号".into(),
        ));
    }
    Ok(phone.into())
}

pub(crate) async fn initialize(db: &DatabaseConnection) -> Result<(), AppError> {
    let mobile = match std::env::var("YAYA_PLATFORM_ADMIN_MOBILE") {
        Ok(v) if !v.trim().is_empty() => normalize_mobile(&v)?,
        _ => return Ok(()),
    };
    initialize_values(
        db,
        &mobile,
        &std::env::var("YAYA_PLATFORM_INSTANCE_ID").unwrap_or_default(),
    )
    .await
}
async fn initialize_values(
    db: &DatabaseConnection,
    mobile: &str,
    instance: &str,
) -> Result<(), AppError> {
    let tx = db.begin().await?;
    let owner = tx
        .query_one_raw(Statement::from_string(
            DbBackend::Postgres,
            "SELECT id FROM iam_users WHERE id='00000000-0000-4000-8000-000000000001' FOR UPDATE"
                .to_string(),
        ))
        .await?
        .ok_or_else(|| AppError::BadRequest("客户平台超级管理员尚未初始化".into()))?;
    let _ = owner;
    if tx
        .query_one_raw(Statement::from_string(
            DbBackend::Postgres,
            "SELECT key FROM instance_delivery_state WHERE key='customer-admin'".to_string(),
        ))
        .await?
        .is_some()
    {
        tx.commit().await?;
        return Ok(());
    }
    let duplicate = tx.query_one_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "SELECT id FROM iam_users WHERE id<>'00000000-0000-4000-8000-000000000001' AND mobile IN ($1,$2) LIMIT 1",
        [mobile.to_owned().into(), format!("+86{mobile}").into()])).await?;
    if duplicate.is_some() {
        return Err(AppError::Conflict(
            "客户管理员手机号已绑定其他用户，请核对后重新部署".into(),
        ));
    }
    tx.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "UPDATE iam_users SET mobile=$1,state_code='86',extension_json=extension_json || '{\"customerAdminProvisioned\":true}'::jsonb,updated_at=NOW() WHERE id='00000000-0000-4000-8000-000000000001'", [mobile.into()])).await?;
    // Customer login uses SMS; fixed development credentials must not survive delivery.
    tx.execute_unprepared(
        "DELETE FROM iam_local_credentials WHERE user_id='00000000-0000-4000-8000-000000000001'",
    )
    .await?;
    tx.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
        "INSERT INTO instance_delivery_state(key,user_id,instance_id) VALUES('customer-admin','00000000-0000-4000-8000-000000000001',$1)", [instance.into()])).await?;
    tx.commit().await?;
    tracing::info!(target: "yaya::delivery", "Customer administrator mobile provisioned");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_customer_mobile() {
        assert_eq!(
            normalize_mobile(" +86 138-0013-8000 ").unwrap(),
            "13800138000"
        );
        for value in ["", "10086", "12800138000", "13800138000\nX=1"] {
            assert!(normalize_mobile(value).is_err());
        }
    }
    #[tokio::test]
    async fn postgres_first_boot_binding_is_atomic_and_never_overwrites_customer_edits() {
        let Ok(url) = std::env::var("YAYA_IDENTITY_TEST_DATABASE_URL") else {
            return;
        };
        let db = sea_orm::Database::connect(&url).await.unwrap();
        db.execute_unprepared("CREATE TABLE iam_users(id UUID PRIMARY KEY,mobile TEXT,state_code TEXT,extension_json JSONB NOT NULL DEFAULT '{}',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE iam_local_credentials(user_id UUID PRIMARY KEY,password TEXT); INSERT INTO iam_users(id) VALUES('00000000-0000-4000-8000-000000000001'); INSERT INTO iam_local_credentials VALUES('00000000-0000-4000-8000-000000000001','yaya');").await.unwrap();
        crate::infrastructure::migrator::customer_delivery_test_migration(&db)
            .await
            .unwrap();
        initialize_values(&db, "13800138000", "test-instance")
            .await
            .unwrap();
        let row = db
            .query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                "SELECT mobile FROM iam_users WHERE id='00000000-0000-4000-8000-000000000001'"
                    .to_string(),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<String>("", "mobile").unwrap(), "13800138000");
        assert!(
            db.query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                "SELECT user_id FROM iam_local_credentials".to_string()
            ))
            .await
            .unwrap()
            .is_none()
        );
        db.execute_unprepared("UPDATE iam_users SET mobile='13900139000',extension_json='{}'; INSERT INTO iam_local_credentials VALUES('00000000-0000-4000-8000-000000000001','customer-custom-password');").await.unwrap();
        initialize_values(&db, "13700137000", "test-instance")
            .await
            .unwrap();
        let row = db
            .query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                "SELECT mobile FROM iam_users WHERE id='00000000-0000-4000-8000-000000000001'"
                    .to_string(),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<String>("", "mobile").unwrap(), "13900139000");
        let credential = db
            .query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                "SELECT password FROM iam_local_credentials".to_string(),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            credential.try_get::<String>("", "password").unwrap(),
            "customer-custom-password"
        );
        db.execute_unprepared("DELETE FROM instance_delivery_state; INSERT INTO iam_users(id,mobile) VALUES('00000000-0000-4000-8000-000000000099','13600136000');").await.unwrap();
        assert!(
            initialize_values(&db, "13600136000", "test-instance")
                .await
                .is_err()
        );
        let row = db
            .query_one_raw(Statement::from_string(
                DbBackend::Postgres,
                "SELECT mobile FROM iam_users WHERE id='00000000-0000-4000-8000-000000000001'"
                    .to_string(),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<String>("", "mobile").unwrap(), "13900139000");
    }
}
