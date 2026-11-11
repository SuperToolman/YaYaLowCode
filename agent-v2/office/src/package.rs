use anyhow::{Result, ensure};
use quick_xml::{Reader, events::Event};
use std::{
    collections::{BTreeMap, HashSet},
    io::{Cursor, Read, Write},
};

/// No archive member is ever extracted to disk or fetched from an external relationship.
pub fn unpack(bytes: &[u8]) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))?;
    ensure!(archive.len() <= 2048, "office_archive_entry_limit");
    let mut total = 0u64;
    let mut names = HashSet::new();
    let mut parts = BTreeMap::new();
    for index in 0..archive.len() {
        let mut file = archive.by_index(index)?;
        let name = file.name()?.into_owned();
        ensure!(
            file.enclosed_name().is_some() && !name.contains('\\'),
            "office_unsafe_archive_path"
        );
        ensure!(names.insert(name.clone()), "office_duplicate_archive_entry");
        total = total
            .checked_add(file.size())
            .ok_or_else(|| anyhow::anyhow!("office_archive_size_limit"))?;
        ensure!(
            total <= 32 * 1024 * 1024 && file.size() <= 8 * 1024 * 1024,
            "office_archive_size_limit"
        );
        ensure!(
            file.size() <= file.compressed_size().saturating_mul(300).max(1024 * 1024),
            "office_archive_ratio_limit"
        );
        if name.ends_with(".xml") || name.ends_with(".rels") || name == "mimetype" {
            let name = name.clone();
            let mut data = Vec::new();
            (&mut file)
                .take(8 * 1024 * 1024 + 1)
                .read_to_end(&mut data)?;
            ensure!(data.len() <= 8 * 1024 * 1024, "office_archive_size_limit");
            if name != "mimetype" {
                validate_xml(&data)?;
            }
            parts.insert(name, data);
        }
    }
    Ok(parts)
}
pub fn validate_xml(bytes: &[u8]) -> Result<()> {
    let mut reader = Reader::from_reader(bytes);
    let mut depth = 0usize;
    loop {
        match reader.read_event()? {
            Event::DocType(_) => anyhow::bail!("office_xml_doctype_forbidden"),
            Event::Start(_) => {
                depth += 1;
                ensure!(depth <= 128, "office_xml_depth_limit");
            }
            Event::End(_) => {
                depth = depth.saturating_sub(1);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    ensure!(depth == 0, "office_xml_unclosed_element");
    Ok(())
}
pub fn zip(parts: Vec<(String, String)>) -> Result<Vec<u8>> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, body) in parts {
        writer.start_file(
            name,
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )?;
        writer.write_all(body.as_bytes())?;
    }
    Ok(writer.finish()?.into_inner())
}
pub fn escape(text: &str) -> Result<String> {
    ensure!(
        text.chars().all(|c| c == '\t'
            || c == '\n'
            || c == '\r'
            || (c >= ' ' && c != '\u{fffe}' && c != '\u{ffff}')),
        "office_invalid_xml_character"
    );
    Ok(quick_xml::escape::escape(text).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_dtd_deep_xml_and_archive_expansion() {
        assert!(
            validate_xml(b"<!DOCTYPE x [<!ENTITY a SYSTEM 'file:///secret'>]><x>&a;</x>").is_err()
        );
        assert!(
            validate_xml(format!("{}{}", "<a>".repeat(130), "</a>".repeat(130)).as_bytes())
                .is_err()
        );
        let bomb = zip(vec![(
            "word/document.xml".into(),
            " ".repeat(2 * 1024 * 1024),
        )])
        .unwrap();
        assert!(unpack(&bomb).is_err());
    }
    #[test]
    fn rejects_path_entries_without_extracting_to_disk() {
        let bytes = zip(vec![("../secret.xml".into(), "<x/>".into())]).unwrap();
        assert!(unpack(&bytes).is_err());
    }
}
