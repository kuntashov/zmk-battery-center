use serde::Deserialize;

fn default_row_count() -> u8 {
    2
}

fn default_components() -> Vec<TrayIconComponent> {
    vec![
        TrayIconComponent::RoleLabel,
        TrayIconComponent::BatteryIcon,
        TrayIconComponent::BatteryPercent,
    ]
}

fn default_color_low_threshold() -> u8 {
    20
}

fn default_color_high_threshold() -> u8 {
    50
}

#[derive(Debug, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrayIconComponent {
    AppIcon,
    RoleLabel,
    BatteryIcon,
    BatteryPercent,
}

#[derive(Debug, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrayBatterySlot {
    pub percent: Option<u8>,
    pub disconnected: bool,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrayBatteryPayload {
    pub enabled: bool,
    #[serde(default)]
    pub slots: Vec<TrayBatterySlot>,
    #[serde(default = "default_color_low_threshold")]
    pub color_low_threshold: u8,
    #[serde(default = "default_color_high_threshold")]
    pub color_high_threshold: u8,
    #[serde(default = "default_components")]
    pub components: Vec<TrayIconComponent>,
    #[serde(default = "default_row_count")]
    pub row_count: u8,
    pub central_percent: Option<u8>,
    pub peripheral_percent: Option<u8>,
    pub central_label: Option<String>,
    pub peripheral_label: Option<String>,
    pub disconnected: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_full_camel_case_payload() {
        let json = r#"{
            "enabled": true,
            "slots": [
                { "percent": 85, "disconnected": false },
                { "percent": null, "disconnected": true }
            ],
            "colorLowThreshold": 20,
            "colorHighThreshold": 50,
            "components": ["roleLabel", "batteryPercent"],
            "rowCount": 1,
            "centralPercent": 85,
            "peripheralPercent": null,
            "centralLabel": "C",
            "peripheralLabel": null,
            "disconnected": false
        }"#;
        let p: TrayBatteryPayload = serde_json::from_str(json).expect("deserialize");
        assert!(p.enabled);
        assert_eq!(
            p.slots,
            vec![
                TrayBatterySlot {
                    percent: Some(85),
                    disconnected: false,
                },
                TrayBatterySlot {
                    percent: None,
                    disconnected: true,
                },
            ]
        );
        assert_eq!(p.color_low_threshold, 20);
        assert_eq!(p.color_high_threshold, 50);
        assert_eq!(
            p.components,
            vec![
                TrayIconComponent::RoleLabel,
                TrayIconComponent::BatteryPercent
            ]
        );
        assert_eq!(p.row_count, 1);
        assert_eq!(p.central_percent, Some(85));
        assert_eq!(p.peripheral_percent, None);
        assert_eq!(p.central_label.as_deref(), Some("C"));
        assert!(!p.disconnected);
    }

    #[test]
    fn missing_components_and_row_count_use_defaults() {
        let json = r#"{
            "enabled": true,
            "centralPercent": null,
            "peripheralPercent": null,
            "centralLabel": null,
            "peripheralLabel": null,
            "disconnected": true
        }"#;
        let p: TrayBatteryPayload = serde_json::from_str(json).expect("deserialize");
        assert_eq!(p.row_count, 2);
        assert!(p.slots.is_empty());
        assert_eq!(p.color_low_threshold, 20);
        assert_eq!(p.color_high_threshold, 50);
        assert_eq!(
            p.components,
            vec![
                TrayIconComponent::RoleLabel,
                TrayIconComponent::BatteryIcon,
                TrayIconComponent::BatteryPercent
            ]
        );
        assert!(p.disconnected);
    }

    #[test]
    fn numeric_payload_fields_enforce_u8_bounds() {
        let json = r#"{
            "enabled": true,
            "slots": [{ "percent": 256, "disconnected": false }],
            "colorLowThreshold": 20,
            "colorHighThreshold": 50,
            "centralPercent": null,
            "peripheralPercent": null,
            "centralLabel": null,
            "peripheralLabel": null,
            "disconnected": false
        }"#;
        assert!(serde_json::from_str::<TrayBatteryPayload>(json).is_err());

        let json = r#"{
            "enabled": true,
            "slots": [],
            "colorLowThreshold": 256,
            "colorHighThreshold": 50,
            "centralPercent": null,
            "peripheralPercent": null,
            "centralLabel": null,
            "peripheralLabel": null,
            "disconnected": false
        }"#;
        assert!(serde_json::from_str::<TrayBatteryPayload>(json).is_err());
    }

    #[test]
    fn unknown_component_variant_is_an_error() {
        let json = r#"{"enabled": true, "components": ["sparkles"], "centralPercent": null,
            "peripheralPercent": null, "centralLabel": null, "peripheralLabel": null, "disconnected": false}"#;
        assert!(serde_json::from_str::<TrayBatteryPayload>(json).is_err());
    }
}
