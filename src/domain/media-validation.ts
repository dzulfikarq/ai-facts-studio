export function validateAudioQuality(input: { expected: boolean; codec: string | null; videoDurationSec: number; audioDurationSec: number | null; expectedAudioDurationSec?: number; meanVolumeDb: number | null; maxVolumeDb: number | null }) {
  if (!input.expected) {
    if (input.meanVolumeDb !== null && input.meanVolumeDb > -50) throw new Error("Audio validation gagal: render tanpa narasi menghasilkan audio non-senyap.");
    return { audioValidation: "silent-expected" as const, audioLevelWarning: null };
  }
  if (input.codec !== "aac") throw new Error("Audio validation gagal: track narasi tidak memakai AAC.");
  if (input.audioDurationSec === null || Math.abs(input.audioDurationSec - input.videoDurationSec) > 0.25) {
    throw new Error("Audio validation gagal: durasi track AAC tidak cocok dengan durasi video; periksa kemungkinan narasi terpotong.");
  }
  if (input.expectedAudioDurationSec && Math.abs(input.audioDurationSec - input.expectedAudioDurationSec) > 0.25) {
    throw new Error("Audio validation gagal: durasi output menyimpang dari audio snapshot yang disetujui.");
  }
  if (input.meanVolumeDb === null || input.meanVolumeDb <= -45) throw new Error("Audio validation gagal: narasi senyap atau terlalu pelan (mean ≤ -45 dB).");
  if (input.maxVolumeDb === null) throw new Error("Audio validation gagal: puncak audio tidak dapat diukur.");
  if (input.maxVolumeDb >= -0.1) throw new Error("Audio validation gagal: puncak mendekati 0 dB; potensi clipping signifikan.");
  return {
    audioValidation: input.meanVolumeDb <= -32 ? "pass-low-level" as const : "pass" as const,
    audioLevelWarning: input.meanVolumeDb <= -32 ? "Level rata-rata rendah; dengarkan output sebelum dipakai." : null,
  };
}
