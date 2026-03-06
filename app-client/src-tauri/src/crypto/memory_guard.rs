use zeroize::Zeroize;

pub struct SensitiveBytes(pub Vec<u8>);

impl Drop for SensitiveBytes {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}
