#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

#[cfg(target_os = "windows")]
use crate::tray_battery_payload::TrayBatteryPayload;
use crate::tray_battery_payload::{
    TrayBatterySlot, DEFAULT_COLOR_HIGH_THRESHOLD, DEFAULT_COLOR_LOW_THRESHOLD,
};

const MIN_ICON_SIZE: u32 = 16;
const MAX_ICON_SIZE: u32 = 32;
const FALLBACK_ICON_SIZE: u32 = 32;
const MAX_VISIBLE_SLOTS: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rgba {
    red: u8,
    green: u8,
    blue: u8,
    alpha: u8,
}

impl Rgba {
    const fn opaque(red: u8, green: u8, blue: u8) -> Self {
        Self {
            red,
            green,
            blue,
            alpha: 255,
        }
    }

    const fn with_alpha(self, alpha: u8) -> Self {
        Self { alpha, ..self }
    }
}

const GREEN: Rgba = Rgba::opaque(0x22, 0xC5, 0x5E);
const YELLOW: Rgba = Rgba::opaque(0xEA, 0xB3, 0x08);
const RED: Rgba = Rgba::opaque(0xEF, 0x44, 0x44);
const GRAY: Rgba = Rgba::opaque(0x94, 0xA3, 0xB8);
const FALLBACK_OUTLINE: Rgba = Rgba::opaque(0x64, 0x74, 0x8B);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PixelRect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct BatteryGeometry {
    body: PixelRect,
    inner: PixelRect,
    terminal: PixelRect,
}

#[derive(Debug, PartialEq, Eq)]
struct RasterizedIcon {
    size: u32,
    rgba: Vec<u8>,
}

fn sanitize_thresholds(low: u8, high: u8) -> (u8, u8) {
    let low = low.clamp(1, 99);
    let high = high.clamp(1, 99);
    if low < high {
        (low, high)
    } else {
        (DEFAULT_COLOR_LOW_THRESHOLD, DEFAULT_COLOR_HIGH_THRESHOLD)
    }
}

fn fill_color(slot: &TrayBatterySlot, low: u8, high: u8) -> Rgba {
    if slot.disconnected || slot.percent.is_none() {
        return GRAY;
    }
    let percent = slot.percent.unwrap_or_default().min(100);
    let (low, high) = sanitize_thresholds(low, high);
    if percent > high {
        GREEN
    } else if percent >= low {
        YELLOW
    } else {
        RED
    }
}

fn choose_icon_size(dimensions: Option<(u32, u32)>) -> u32 {
    let Some((width, height)) = dimensions else {
        return FALLBACK_ICON_SIZE;
    };
    if width == 0 || height == 0 {
        return FALLBACK_ICON_SIZE;
    }
    width.min(height).clamp(MIN_ICON_SIZE, MAX_ICON_SIZE)
}

fn battery_geometries(size: u32, row_count: usize) -> Vec<BatteryGeometry> {
    if row_count == 0 {
        return Vec::new();
    }

    let row_count = row_count.min(MAX_VISIBLE_SLOTS) as u32;
    let margin = (size / 16).max(1);
    let base_gap = (size / 16).max(1);
    let gap = base_gap + 1;
    let terminal_width = (size / 16).max(1);
    let outline = if size >= 28 { 2 } else { 1 };
    let available_height = size.saturating_sub(margin * 2 + base_gap.saturating_mul(row_count - 1));
    let row_height = (available_height / row_count).min(size / 2).max(3);
    let total_height = row_height * row_count + gap * (row_count - 1);
    let start_y = size.saturating_sub(total_height) / 2;
    let available_width = size.saturating_sub(margin * 2);
    let body_width = available_width.saturating_sub(terminal_width).max(3);

    (0..row_count)
        .map(|row| {
            let y = start_y + row * (row_height + gap);
            let body = PixelRect {
                x: margin,
                y,
                width: body_width,
                height: row_height,
            };
            let inner = PixelRect {
                x: body.x + outline,
                y: body.y + outline,
                width: body.width.saturating_sub(outline * 2),
                height: body.height.saturating_sub(outline * 2),
            };
            let terminal_height = (body.height / 2).max(2).min(body.height);
            let terminal = PixelRect {
                x: body.x + body.width,
                y: body.y + (body.height - terminal_height) / 2,
                width: terminal_width,
                height: terminal_height,
            };
            BatteryGeometry {
                body,
                inner,
                terminal,
            }
        })
        .collect()
}

fn fill_rect(buffer: &mut [u8], size: u32, rect: PixelRect, color: Rgba) {
    let max_x = rect.x.saturating_add(rect.width).min(size);
    let max_y = rect.y.saturating_add(rect.height).min(size);
    for y in rect.y.min(size)..max_y {
        for x in rect.x.min(size)..max_x {
            let offset = ((y * size + x) * 4) as usize;
            if let Some(pixel) = buffer.get_mut(offset..offset + 4) {
                pixel.copy_from_slice(&[color.red, color.green, color.blue, color.alpha]);
            }
        }
    }
}

fn render_battery(
    buffer: &mut [u8],
    size: u32,
    geometry: BatteryGeometry,
    slot: &TrayBatterySlot,
    low: u8,
    high: u8,
    neutral_outline: Rgba,
) {
    let is_muted = slot.disconnected || slot.percent.is_none();
    let outline = if is_muted { GRAY } else { neutral_outline };

    fill_rect(buffer, size, geometry.body, outline);
    fill_rect(buffer, size, geometry.inner, outline.with_alpha(48));
    fill_rect(buffer, size, geometry.terminal, outline);

    let Some(percent) = slot.percent else {
        return;
    };
    let percent = u32::from(percent.min(100));
    if percent == 0 || geometry.inner.width == 0 {
        return;
    }
    let fill_width = (geometry.inner.width * percent).div_ceil(100).max(1);
    fill_rect(
        buffer,
        size,
        PixelRect {
            width: fill_width,
            ..geometry.inner
        },
        fill_color(slot, low, high),
    );
}

fn rasterize_battery_slots(
    slots: &[TrayBatterySlot],
    requested_size: u32,
    color_low_threshold: u8,
    color_high_threshold: u8,
    neutral_outline: Rgba,
) -> RasterizedIcon {
    let size = requested_size.clamp(MIN_ICON_SIZE, MAX_ICON_SIZE);
    let mut rgba = vec![0; (size * size * 4) as usize];
    let visible_slots = &slots[..slots.len().min(MAX_VISIBLE_SLOTS)];
    let geometries = battery_geometries(size, visible_slots.len());
    for (slot, geometry) in visible_slots.iter().zip(geometries) {
        render_battery(
            &mut rgba,
            size,
            geometry,
            slot,
            color_low_threshold,
            color_high_threshold,
            neutral_outline,
        );
    }
    RasterizedIcon { size, rgba }
}

#[cfg(target_os = "windows")]
fn logical_dimension(value: f64) -> Option<u32> {
    if value.is_finite() && value > 0.0 {
        Some(value.round() as u32)
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn tray_dimensions<R: tauri::Runtime>(tray: &tauri::tray::TrayIcon<R>) -> Option<(u32, u32)> {
    match tray.rect() {
        Ok(Some(rect)) => match rect.size {
            tauri::Size::Physical(size) => Some((size.width, size.height)),
            tauri::Size::Logical(size) => Some((
                logical_dimension(size.width)?,
                logical_dimension(size.height)?,
            )),
        },
        Ok(None) => None,
        Err(error) => {
            log::warn!("Windows tray: failed to read tray icon rect, using 32 px: {error}");
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn system_outline_color() -> Rgba {
    use windows::UI::ViewManagement::{UIColorType, UISettings};

    match UISettings::new().and_then(|settings| settings.GetColorValue(UIColorType::Foreground)) {
        Ok(color) => Rgba::opaque(color.R, color.G, color.B),
        Err(error) => {
            log::warn!(
                "Windows tray: failed to read system foreground color, using fallback: {error}"
            );
            FALLBACK_OUTLINE
        }
    }
}

#[cfg(target_os = "windows")]
pub fn apply_tray_battery_state<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    payload: &TrayBatteryPayload,
) -> Result<(), String> {
    use tauri::image::Image;

    let tray = app
        .tray_by_id("tray_icon")
        .ok_or_else(|| "Windows tray: icon 'tray_icon' was not found".to_string())?;

    if !payload.enabled || payload.slots.is_empty() {
        let icon = Image::from_bytes(include_bytes!("../icons/32x32.png")).map_err(|error| {
            format!("Windows tray: failed to decode embedded app icon: {error}")
        })?;
        return tray
            .set_icon(Some(icon))
            .map_err(|error| format!("Windows tray: failed to restore app icon: {error}"));
    }

    let size = choose_icon_size(tray_dimensions(&tray));
    let rendered = rasterize_battery_slots(
        &payload.slots,
        size,
        payload.color_low_threshold,
        payload.color_high_threshold,
        system_outline_color(),
    );
    let icon = Image::new_owned(rendered.rgba, rendered.size, rendered.size);
    tray.set_icon(Some(icon))
        .map_err(|error| format!("Windows tray: failed to set battery icon: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(percent: Option<u8>, disconnected: bool) -> TrayBatterySlot {
        TrayBatterySlot {
            percent,
            disconnected,
        }
    }

    fn pixel(image: &RasterizedIcon, x: u32, y: u32) -> Rgba {
        let offset = ((y * image.size + x) * 4) as usize;
        Rgba {
            red: image.rgba[offset],
            green: image.rgba[offset + 1],
            blue: image.rgba[offset + 2],
            alpha: image.rgba[offset + 3],
        }
    }

    fn colored_width(image: &RasterizedIcon, rect: PixelRect, color: Rgba) -> u32 {
        (rect.x..rect.x + rect.width)
            .filter(|x| pixel(image, *x, rect.y) == color)
            .count() as u32
    }

    fn assert_rect_inside(rect: PixelRect, size: u32) {
        assert!(rect.x + rect.width <= size);
        assert!(rect.y + rect.height <= size);
    }

    #[test]
    fn classifies_default_and_custom_threshold_boundaries() {
        for (percent, expected) in [(19, RED), (20, YELLOW), (50, YELLOW), (51, GREEN)] {
            assert_eq!(fill_color(&slot(Some(percent), false), 20, 50), expected);
        }
        for (percent, expected) in [(29, RED), (30, YELLOW), (70, YELLOW), (71, GREEN)] {
            assert_eq!(fill_color(&slot(Some(percent), false), 30, 70), expected);
        }
    }

    #[test]
    fn uses_the_required_status_palette() {
        assert_eq!(GREEN, Rgba::opaque(0x22, 0xC5, 0x5E));
        assert_eq!(YELLOW, Rgba::opaque(0xEA, 0xB3, 0x08));
        assert_eq!(RED, Rgba::opaque(0xEF, 0x44, 0x44));
        assert_eq!(GRAY, Rgba::opaque(0x94, 0xA3, 0xB8));
    }

    #[test]
    fn sanitizes_malformed_thresholds_to_defaults() {
        assert_eq!(sanitize_thresholds(0, 255), (1, 99));
        assert_eq!(
            sanitize_thresholds(99, 20),
            (DEFAULT_COLOR_LOW_THRESHOLD, DEFAULT_COLOR_HIGH_THRESHOLD)
        );
        assert_eq!(
            sanitize_thresholds(100, 100),
            (DEFAULT_COLOR_LOW_THRESHOLD, DEFAULT_COLOR_HIGH_THRESHOLD)
        );
        assert_eq!(fill_color(&slot(Some(51), false), 99, 20), GREEN);
    }

    #[test]
    fn renders_supported_sizes_with_transparency() {
        for size in [16, 20, 24, 32] {
            let image =
                rasterize_battery_slots(&[slot(Some(50), false)], size, 20, 50, FALLBACK_OUTLINE);
            assert_eq!(image.size, size);
            assert_eq!(image.rgba.len(), (size * size * 4) as usize);
            assert!(image.rgba.chunks_exact(4).any(|pixel| pixel[3] == 0));
            assert!(image.rgba.chunks_exact(4).any(|pixel| pixel[3] == 255));
        }
    }

    #[test]
    fn renders_three_slot_colors_from_top_to_bottom() {
        let image = rasterize_battery_slots(
            &[
                slot(Some(80), false),
                slot(Some(35), false),
                slot(Some(10), false),
            ],
            32,
            20,
            50,
            FALLBACK_OUTLINE,
        );
        let geometries = battery_geometries(32, 3);
        for (geometry, expected) in geometries.iter().zip([GREEN, YELLOW, RED]) {
            assert_eq!(pixel(&image, geometry.inner.x, geometry.inner.y), expected);
        }
    }

    #[test]
    fn adds_one_transparent_pixel_between_three_batteries() {
        for (size, expected_gap, expected_body_height) in [(16, 2, 4), (32, 3, 8)] {
            let slots = [
                slot(Some(80), false),
                slot(Some(80), false),
                slot(Some(80), false),
            ];
            let image = rasterize_battery_slots(&slots, size, 20, 50, FALLBACK_OUTLINE);
            let geometries = battery_geometries(size, slots.len());

            for rows in geometries.windows(2) {
                let gap_start = rows[0].body.y + rows[0].body.height;
                let actual_gap = rows[1].body.y - gap_start;
                assert_eq!(actual_gap, expected_gap);
                for y in gap_start..rows[1].body.y {
                    assert!((0..size).all(|x| pixel(&image, x, y).alpha == 0));
                }
            }

            assert!(geometries
                .iter()
                .all(|geometry| geometry.body.height == expected_body_height));
        }
    }

    #[test]
    fn keeps_supported_geometries_disjoint_and_inside_the_icon() {
        for size in MIN_ICON_SIZE..=MAX_ICON_SIZE {
            for row_count in 1..=MAX_VISIBLE_SLOTS {
                let geometries = battery_geometries(size, row_count);

                for geometry in &geometries {
                    assert_rect_inside(geometry.body, size);
                    assert_rect_inside(geometry.inner, size);
                    assert_rect_inside(geometry.terminal, size);
                }

                for rows in geometries.windows(2) {
                    assert!(rows[0].body.y + rows[0].body.height <= rows[1].body.y);
                }
            }
        }
    }

    #[test]
    fn renders_zero_small_half_full_and_clamped_fill_levels() {
        let geometry = battery_geometries(32, 1)[0];
        for (percent, expected_width) in [
            (0, 0),
            (1, 1),
            (50, geometry.inner.width.div_ceil(2)),
            (100, geometry.inner.width),
            (255, geometry.inner.width),
        ] {
            let battery_slot = slot(Some(percent), false);
            let image = rasterize_battery_slots(
                std::slice::from_ref(&battery_slot),
                32,
                20,
                50,
                FALLBACK_OUTLINE,
            );
            assert_eq!(
                colored_width(&image, geometry.inner, fill_color(&battery_slot, 20, 50)),
                expected_width
            );
        }
    }

    #[test]
    fn renders_disconnected_and_unknown_slots_in_gray() {
        let image = rasterize_battery_slots(
            &[slot(Some(50), true), slot(None, false)],
            32,
            20,
            50,
            FALLBACK_OUTLINE,
        );
        let geometries = battery_geometries(32, 2);

        assert_eq!(
            pixel(&image, geometries[0].inner.x, geometries[0].inner.y),
            GRAY
        );
        assert_eq!(
            pixel(&image, geometries[1].body.x, geometries[1].body.y),
            GRAY
        );
        let unknown_empty = pixel(&image, geometries[1].inner.x, geometries[1].inner.y);
        assert_eq!(
            (unknown_empty.red, unknown_empty.green, unknown_empty.blue),
            (GRAY.red, GRAY.green, GRAY.blue)
        );
        assert!(unknown_empty.alpha < 255);
    }

    #[test]
    fn ignores_slots_after_the_first_three() {
        let image = rasterize_battery_slots(
            &[
                slot(Some(10), false),
                slot(Some(35), false),
                slot(Some(80), false),
                slot(Some(50), true),
            ],
            32,
            20,
            50,
            FALLBACK_OUTLINE,
        );

        assert!(!image
            .rgba
            .chunks_exact(4)
            .any(|pixel| pixel == [GRAY.red, GRAY.green, GRAY.blue, GRAY.alpha]));
    }

    #[test]
    fn chooses_square_size_from_rect_dimensions_with_fallbacks() {
        assert_eq!(choose_icon_size(None), 32);
        assert_eq!(choose_icon_size(Some((0, 24))), 32);
        assert_eq!(choose_icon_size(Some((8, 40))), 16);
        assert_eq!(choose_icon_size(Some((24, 20))), 20);
        assert_eq!(choose_icon_size(Some((48, 40))), 32);
    }
}
