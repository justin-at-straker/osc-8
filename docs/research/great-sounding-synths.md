# What makes software synths sound great, and what OSC-8 should change

Research date: 2026-11-15. Scope: the DSP behind well-regarded soft synths (Serum, Vital, Diva, Surge XT, u-he generally), checked against OSC-8's actual engine code (`engine/src/*.rs` at commit `2097184`).

Sourcing rule: every external claim links to the source that owns it, such as open-source code, a developer-authored paper or slide deck, or an official manual. Where I could not retrieve a primary source in this session I say so. Statements about OSC-8 come from reading the engine source. Numbers marked **[sim]** come from a Python model of OSC-8's wavetable read path (described in the appendix). That model is not in the repo.

> **Status (2026-11-15):** R1–R8 are implemented. Two deviations from the text below:
> - R1: the mip blend weight steps once per control tick rather than ramping per sample. A per-sample ramp would cross the level switch mid-tick.
> - R6: unison voices get fixed per-voice offsets, not a slow wander of their own. Osc A and osc B each wander independently.
> - R3: the transparent knee clipper is in. The master DC blocker was dropped. Nothing in the current path produces DC (the tube shaper has its own blocker), and the blocker's long IIR tail broke the engine's guarantee that silence is exactly silent.
>
> The 2x quality mode is in too (`engine/src/oversample.rs`, the Quality switch in the Voice module, default 1x).
>
> Not done yet: extra filter responses, the analog attack curve, and per-sample pitch ramps.

---

## 1. Summary: the changes most likely to improve OSC-8's sound, ranked by impact per effort

| # | Change | Why (by ear) | Effort | CPU |
|---|--------|--------------|--------|-----|
| 1 | **Fix the octave "brightness steps" in mip selection.** Let each mip level keep harmonics up to the point where aliases land above ~18 kHz, then crossfade between neighbouring levels near the boundaries. | Today the top harmonic falls from ~24 kHz to ~12 kHz each time a note crosses a level boundary (e.g. 93.0 Hz → 94.5 Hz) **[sim]**. You hear it on glides, vibrato, and the move from one key to the next, and the whole unison stack switches when Detune changes. | Small (margin) / medium (crossfade) | 0 for the margin; reads roughly double only inside the crossfade zone |
| 2 | **Fix the filter drive limiter so it acts on the resonant stage.** Then put the saturation *inside* the resonance loop, and anti-alias the drive with 1st-order ADAA. | `Svf::limit` runs on `fl[0]`/`fr[0]`, the low-Q stage, but the resonant peak is in `fl[1]`. So "resonance grows warmer and rounder" doesn't happen where the comment says it does. The tanh at the filter input is also unoversampled at up to 7x gain. | Small–medium | Low (one log per sample per channel when drive > 0) |
| 3 | **Make the master clipper transparent below about -3 dBFS and add a DC blocker.** | `tanh` on the whole mix adds about -34 dB of 3rd harmonic at 0.5 peak and about -46 dB at 0.25 peak (Taylor estimate). That grit and intermodulation lands on every chord and on the drums. | Small | Negligible |
| 4 | **Use cubic (Catmull-Rom) phase interpolation on the low mip levels (0–2).** | Linear interpolation gives only 47–57 dB SNR on a saw below ~C3, against 58–76 dB for cubic **[sim]**. Vital uses Catmull-Rom on its main path. | Small | About +2 table taps per stream, only for notes below ~95 Hz |
| 5 | **Modulate a few reverb delay lines** slowly (around 1 Hz, a few samples deep). | Static FDN delays give "picket fence" metallic modes. Dattorro calls the modulation "a godsend" for bright sources. Vital's reverb has built-in delay "chorus". | Small | Negligible |
| 6 | **Richer analog drift.** Give osc A and osc B independent wander, give each unison voice its own slow drift, and add small per-voice variance on envelope times (Diva-style "Variance"). | Today A and B share one wander value and unison voices never drift. Diva and Surge both drift per oscillator or per unison voice. | Small | Negligible |
| 7 | **Unison: add a detune-curve parameter and interleave sharp/flat voices across L/R.** | Vital (`detune_power`) and Serum (Linear/Super/Exp) both expose the detune distribution. Surge alternates pan sign so each side gets sharp *and* flat voices, while OSC-8 maps flat → left and sharp → right. | Small | 0 |
| 8 | **Chorus: cubic interpolation, plus a gentle low-pass on the wet signal.** | Dattorro: linear-interpolated modulated delays cause a "significant perceived loss of high-frequency content". | Small | Low |

Two larger items that are not in the top 8, because they cost a lot or are already partly in place:
- **Optional 2x oversampled voice path ("Quality" setting).** Serum 2 ships 1x/2x/4x, Vital oversamples voices and effects (2x by default at 44.1/48 kHz), and Surge runs its voice path at 2x. OSC-8 would pay roughly 2x voice CPU in WASM. Do this after items 1–4, which take care of most of the audible aliasing much more cheaply.
- **More filter responses.** The Simper SVF already computes band-pass and high-pass at no extra cost. A ladder model adds character but is a project of its own.

What OSC-8 already does well and should keep: random start phase by default (Serum and Vital default to full randomization as well), power-normalized unison, envelopes that retrigger from the current level, voices stolen without resetting phase or filter state, control-rate values ramped linearly per sample (the same scheme Surge uses), a Simper/Cytomic trapezoidal SVF, a 2x-oversampled distortion with DC blocking, and a click-free FX bypass crossfade.

---

## 2. Findings by topic

### 2.1 Oscillator anti-aliasing and interpolation

**What the reference synths do**

- **Vital** does not use fixed octave mips. Its wavetable stores each frame's *frequency-domain* data (`frequency_amplitudes`, `phases`) ([wavetable.h](https://github.com/mtytel/vital/blob/main/src/synthesis/lookups/wavetable.h)). The oscillator rebuilds a band-limited waveform by inverse FFT, using a harmonic cutoff computed from a *fractional* log2 frequency bin (`last_harmonic = kWaveformSize * exp2(-bin_shift)`). It rebuilds whenever the previous buffer finishes a **7 ms crossfade** (`kWavetableFadeTime = 0.007f`), so brightness tracks pitch in whole-harmonic steps instead of octave steps. Reads use **4-point Catmull-Rom** interpolation (`getCatmullInterpolationMatrix`) ([synth_oscillator.cpp](https://github.com/mtytel/vital/blob/main/src/synthesis/producers/synth_oscillator.cpp)).
- **Surge XT's** wavetable oscillator picks a mipmap level with a deliberate bias (`wtbias = 1.8f`). It writes band-limited steps through a windowed-sinc table (BLIT-style) and integrates them with a pitch-dependent leaky integrator ([WavetableOscillator.cpp](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/oscillators/WavetableOscillator.cpp)). It has no crossfade between mip levels, but the level only changes at waveform-state boundaries. The whole voice path runs at `OSC_OVERSAMPLING = 2` ([globals.h](https://github.com/surge-synthesizer/surge/blob/main/src/common/globals.h); [SurgeVoice.cpp](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/SurgeVoice.cpp) clears and fills buffers at `BLOCK_SIZE_OS` and mentions "the 2x gain of the halfband filter").
- **Serum 2** says its playback gives "a high-frequency representation to the limits of the human ear, without the audible aliasing artifacts", at the cost of extra CPU (User Guide p. 37). It offers global **Draft 1x / High 2x / Ultra 4x oversampling** (p. 319) ([Serum 2 User Guide](https://xferrecords.com/manual/serum-2)).
- **Perception.** Välimäki, Pekonen and Nam note that aliasing below the hearing threshold is inaudible, and that this "is common especially at frequencies above 15 kHz, where the hearing threshold increases dramatically" ([JASA 2012, §IV](https://mac.kaist.ac.kr/pubs/ValimakiPeknenNam-jasa2012.pdf)). That gives you a free margin: alias components that fold into roughly 18–24 kHz are effectively silent. Missing harmonics between 12 and 16 kHz, on the other hand, are audible.
- **Interpolation order.** Niemitalo shows that interpolation quality depends on how oversampled the stored data is: "Drop-sample and linear interpolation (as such) are not adequate for high-quality resampling", and the right interpolator depends on "the oversampling ratios you can afford" ([Polynomial Interpolators for High-Quality Resampling of Oversampled Audio, 2001](https://yehar.com/blog/wp-content/uploads/2009/08/deip.pdf), §1 and §9).

**OSC-8 today** (`wavetable.rs`)

- Tables are 2048 samples, with 11 mip levels where level *k* keeps harmonics `1..=1024>>k`. Mips are one octave apart.
- `level_for` picks the *least* band-limited level whose harmonics all fit under Nyquist. The result is no aliasing, but at the bottom of every level's range the top harmonic sits at only about Nyquist/2:

  | f (Hz) | level | top harmonic **[sim]** |
  |---|---|---|
  | 93.0 | 2 | 23.8 kHz |
  | 94.5 | 3 | **12.1 kHz** |
  | 374.0 | 4 | 23.9 kHz |
  | 376.0 | 5 | **12.0 kHz** |
  | 1499 | 6 | 24.0 kHz |
  | 1501 | 7 | **12.0 kHz** |

  This causes an audible brightness jump of nearly an octave of bandwidth at F#2, F#3, F#4, F#5 and F#6 (at 48 kHz). The level is chosen once per control tick from the outermost unison voice's increment (`osc_targets`, `t.mip = level_for(max_inc...)`) and is switched with no crossfade. So the jump also happens mid-note during vibrato or glide, and when the Detune knob widens the stack.
- Phase interpolation is linear (`Wavetable::read`). Frame interpolation is a linear crossfade between adjacent frames. That second part is standard: Serum's manual calls crossfade morphing "what many wavetable synths do automatically" (p. 347).
- The table's oversampling ratio is `2048 / (2 × harmonics)`. That is 1x at level 0, 2x at level 1 and 4x at level 2, so linear interpolation is weakest exactly on bass notes. Saw SNR against an ideal band-limited saw at 48 kHz **[sim]**:

  | note | f | level | linear SNR (all / <16 kHz) | Catmull-Rom SNR |
  |---|---|---|---|---|
  | C1 | 32.7 | 1 | 47.2 / 47.8 dB | 58.1 / 58.7 dB |
  | C2 | 65.4 | 2 | 56.0 / 57.1 dB | 75.9 / 81.1 dB |
  | C3 | 130.8 | 3 | 65.0 / 65.7 dB | 92.5 / 93.1 dB |
  | C4 | 261.6 | 4 | 73.9 / 74.8 dB | 108 / 110 dB |

  From about C3 upward, linear interpolation is clean enough. Below that it is marginal.

**Recommended**

1. *Alias margin (free).* Choose the level from an allowed top-harmonic frequency of `sr - 18000` instead of `sr/2`. A harmonic at frequency `h·f > sr/2` folds to `sr - h·f`, which is at or above 18 kHz as long as `h·f ≤ sr - 18 kHz`. At 48 kHz that allows harmonics up to 30 kHz, and the worst-case bandwidth at the bottom of a level rises from 12 kHz to **15 kHz**. At 44.1 kHz the margin is 26.1 kHz, so the worst case is about 13 kHz. That is still a step, which is why item 2 exists.
2. *Crossfade between level L and L+1 near each boundary.* Compute `x = log2(max_h_allowed_at_level_0 / max_h_needed)` as a fractional level, use `L = floor(x)`, and blend `w = clamp((frac(x) - 0.75) * 4, 0, 1)`. This reads two levels only in the top quarter-octave of each range. Crossfading two band-limited versions of the same waveform simply fades the top octave of harmonics in or out, which is the brightness-versus-pitch behaviour Vital gets from its per-harmonic cutoff. Make `w` part of the per-tick ramped control values (like `C_POS_A`) so it moves smoothly instead of stepping per tick.
3. *Cubic phase interpolation on levels 0–2 only.* Notes above ~95 Hz already sit on 8x-or-better oversampled levels, where linear interpolation is above 65 dB **[sim]**. A branch on `o.mip <= 2` keeps the hot loop linear for most notes. (Doubling the table size for levels 0–1 would also work, but it costs memory, which matters in WASM.)

### 2.2 Filter design

**What the reference synths do**

- **ZDF/TPT is the baseline.** Diva's manual explains why one-sample-delay feedback "smears" at high resonance, and that Diva solves its zero-delay-feedback filters iteratively. They usually converge in 1–2 passes, but "it can take up to 15 cycles if the resonance is very high". The "draft" accuracy mode is the only one where resonance is "primitive (not 'zero delay')" ([Diva User Guide v1.4.8](https://u-he.com/downloads/manuals/plugins/diva/Diva-user-guide.pdf), "Zero Delay Feedback Filters" and "Accuracy"). Simper's trapezoidal SVF stays "stable and smooth even with audio rate modulation" ([SvfLinearTrapOptimised2, p. 31](https://cytomic.com/files/dsp/SvfLinearTrapOptimised2.pdf)).
- **The saturation goes inside the feedback loop.** Vital's ladder computes `filter_input = audio_in * drive - resonance * filter_state` and then `tanh`s it ([ladder_filter.cpp](https://github.com/mtytel/vital/blob/main/src/synthesis/filters/ladder_filter.cpp)). Its "analog" Sallen-Key does the same: `tanh((drive * audio_in - resonance * feedback) * normalizer)`, with resonance only in the second 2-pole loop of the 24 dB cascade ([sallen_key_filter.cpp](https://github.com/mtytel/vital/blob/main/src/synthesis/filters/sallen_key_filter.cpp)). Huovilainen's Moog model puts a tanh in every stage and the feedback ("each stage uses as input the tanh of the output of the previous stage"), and says "since there is a non-linearity, oversampling must be used" ([DAFx-04](https://dafx.de/paper-archive/2004/P_061.PDF), §4). Surge's "Cutoff Warp" and "Resonance Warp" filters exist specifically for level-dependent behaviour: cutoff rises, or resonance falls, as the signal gets louder ([Surge XT manual](https://surge-synthesizer.github.io/manual-xt/), Filters).
- **Gain compensation.** Vital scales input drive by resonance in some modes (`drive_mult = resonance_percent + 1`) and applies post-filter makeup `1/sqrt(...)` based on drive and resonance (ladder and Sallen-Key files above).
- **Aliasing of nonlinear filters.** Simper: "Mostly better off oversampling to contain harmonics than spend more CPU on higher order methods". Anti-derivative anti-aliasing (ADAA) "adds 1/2 sample delay", and "oversampling still helps" ([ADC 2020 slides](https://cytomic.com/files/dsp/adc-2020-andrew-simper-circuit-to-code-slides.pdf), "Discretization Options" and "Aliasing").
- I could not retrieve Zavalishin's *The Art of VA Filter Design* this session (the Native Instruments URLs return 404). It is the standard TPT reference, but I am not citing specific sections of it.

**OSC-8 today** (`synth.rs`)

- Two cascaded Simper SVF low-passes per channel give 24 dB/oct, with Butterworth k values (1.848 / 0.765). Resonance lowers `k2` to 0.04 (Q ≈ 25) and `k1` to 1.248. An SVF low-pass has unity DC gain, so there is no ladder-style bass loss to compensate.
- Drive: `drive_sat` is a tanh at the **filter input** (outside the resonant loop), at up to 7x gain, running at the base sample rate.
- The "soft-limit the band-pass state" step, `Svf::limit`, is applied to `v.fl[0]` and `v.fr[0]`, the **first, low-Q stage**. The resonant peak lives in the second stage (`fl[1]`, `k2`), so the limiter barely touches the resonance it is meant to round off. *Please confirm by listening, because this looks unintended.* The existing `driven_resonant_filter_stays_bounded` test only asserts that the peak stays below 4.0, so it would not catch this.
- There is only a low-pass response.

**Recommended**

1. Apply the `limit` to stage 2's band-pass state (`fl[1]`, `fr[1]`). That stage holds the resonance energy. Keep or reduce the stage-1 limit.
2. To get Vital/Huovilainen-style behaviour, saturate the signal entering the *resonant* stage, i.e. `fl[1].lowpass(c2, sat(y1))`, so that loud input compresses the resonant peak. Today the saturator only shapes the input before both stages.
3. Anti-alias the drive tanh with first-order ADAA (Parker, Zavalishin and Le Bivic, see §2.3). It sits outside any loop, so the half-sample delay is harmless. `tanh_fast(u) = u(27+u²)/(27+9u²)` has the closed-form antiderivative `F(u) = u²/18 + (4/3)·ln(9u² + 27)` for |u| ≤ 3, continuing as `|u| - 3 + F(3)` beyond the clamp (I derived this by hand; check it in a unit test). ADAA1 is `y = (F(uₙ) - F(uₙ₋₁)) / (uₙ - uₙ₋₁)`, falling back to `tanh_fast((uₙ+uₙ₋₁)/2)` when |Δu| < ~1e-4, which handles the ill-conditioning the paper describes in §2.3.
4. Expose high-pass, band-pass and notch from the same SVF. The Simper SVF computes v1 (band-pass) and v2 (low-pass) already, and high-pass is `v0 - k·v1 - v2` ([SvfLinearTrapOptimised2](https://cytomic.com/files/dsp/SvfLinearTrapOptimised2.pdf)).

### 2.3 Where saturation goes, and how to oversample it

**Evidence.** In Parker, Zavalishin and Le Bivic's hard-clipper test (input gain 10), matching the alias SNR of 1st-order ADAA needed **12x** oversampling with no anti-aliasing, against **4x** with ADAA (Table 1). They also show how to remove the ADAA delay when the shaper sits inside feedback (§6) ([DAFx-16](https://dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf)). Vital applies oversampling to the voice handler *and* the effect chain, with one `Decimator` at the end. The `oversampling` parameter is an exponent (`1 << oversampling`), defaults to 1 (2x), and is halved at 88.2/96 kHz ([sound_engine.cpp](https://github.com/mtytel/vital/blob/main/src/synthesis/synth_engine/sound_engine.cpp); [synth_parameters.cpp](https://github.com/mtytel/vital/blob/main/src/common/synth_parameters.cpp)).

**OSC-8 today.** The distortion FX is 2x oversampled with a 31-tap Blackman halfband and a 10 Hz DC blocker (`fx/distortion.rs`), which is good. Filter drive is not oversampled (see §2.2). The master `tanh` is not oversampled (see §2.7).

**Recommended.** ADAA1 on filter drive, and a mostly-linear master clipper (§2.7). Consider a global 2x "High quality" mode later. It would wrap `WavetableSynth::render` (upsampled voice rendering plus one halfband decimator) and roughly double voice CPU, so profile it in the browser first.

### 2.4 Analog drift and voice-to-voice variation

**What the reference synths do**

- **Diva** "Trimmers": per-voice, per-oscillator detune knobs (8 per row, reused for 16 voices), Detune Amt, **Voice Drift** ("a slow wavering of the overall pitch"), and **Variance**, which "applies random offsets ('slop') to cutoff, envelope times, pulse widths (waveform) and glide times". Its "Voice Map" modulator gives fixed per-voice offsets for any target ([Diva User Guide v1.4.8](https://u-he.com/downloads/manuals/plugins/diva/Diva-user-guide.pdf), "Trimmers"). Diva's manual ("Out of tune?" tip) tells users who find presets out of tune to turn down Detune Amt and Voice Drift, so the slop is deliberate and adjustable.
- **Surge** runs a `DriftLFO` *per unison voice* inside the wavetable oscillator (`driftLFO[voice]`). It is uniform noise through a very slow one-pole (`filter = 0.00001f`), scaled by `1/sqrt(filter)` ([WavetableOscillator.cpp](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/oscillators/WavetableOscillator.cpp); [OscillatorDriftUnisonCharacter.h](https://github.com/surge-synthesizer/sst-basic-blocks/blob/main/include/sst/basic-blocks/dsp/OscillatorDriftUnisonCharacter.h)). The manual describes Osc Drift as varying "the pitch of all oscillators and their unison voices" independently ([Surge XT manual](https://surge-synthesizer.github.io/manual-xt/)).

**OSC-8 today.** There is one Drift knob. Per voice: a fixed offset for osc A, osc B and cutoff (±6 cents, ±0.12 oct), plus **one shared** wander (±4 cents, a new target every 0.5–2 s, eased with τ = 0.6 s) that is added to both A and B (`voice_targets`: `cents_a`/`cents_b` both use `wander`). Unison voices inside a stack never drift relative to each other.

**Recommended.** Give osc A and osc B separate `wander` states. Optionally add a per-unison-voice wander at around half the depth, which costs one extra smoothed random per stream per tick. Add drift-scaled per-voice variance on env1 attack, decay and release (e.g. ±8% at Drift 1), like Diva's Variance. The smallest version stores a per-voice multiplier and scales `attack_inc`, `decay_coef` and `release_coef` when the voice starts. The depth numbers are taste: tune them by ear, since none of the sources give values.

### 2.5 Unison

**What the reference synths do**

- **Vital:** `detune_power` (default 1.5, range ±5) reshapes the position of each detuned voice (`powerScale(t, power)`). Sharp and flat voices alternate, `random_phase` defaults to 1.0, `stereo_spread` uses equal-power fades, and levels split 0.4 centre / 0.6 detuned, normalised by `1/sqrt` ([synth_oscillator.cpp](https://github.com/mtytel/vital/blob/main/src/synthesis/producers/synth_oscillator.cpp); [synth_parameters.cpp](https://github.com/mtytel/vital/blob/main/src/common/synth_parameters.cpp)).
- **Serum 2:** detune modes **Linear / Super / Exp**. BLEND is a centre-versus-unison mix (default 75%), and RAND removes the "laser zap" you get from in-phase restarts (User Guide pp. 43, 46–47).
- **Surge:** linear detune across voices, `1/sqrt(n)` level compensation, and a pan position that **flips sign on odd-indexed voices**, so neither side gets only the flat or only the sharp voices ([OscillatorDriftUnisonCharacter.h](https://github.com/surge-synthesizer/sst-basic-blocks/blob/main/include/sst/basic-blocks/dsp/OscillatorDriftUnisonCharacter.h)).
- The JP-8000 "supersaw" analysis by Adam Szabo (KTH, 2010) is widely cited for its non-linear detune and mix curves. I could not retrieve the thesis this session, so I am not relying on its numbers.

**OSC-8 today.** Positions are linear plus a golden-angle jitter, with ±1 semitone at Detune 1. Blend works like Serum's, with power normalization. Pan is monotonic in pitch (`p = pan + sign(x)·|x|^0.25·spread`), so the flattest voice is hardest left and the sharpest hardest right. Random phase defaults to 1.

**Recommended.** (a) Add a "Detune curve" parameter applying `sign(x)·|x|^p` (p of about 1.5 matches Vital's default and puts more voices near the centre). (b) Interleave pan, mapping voice order to pan as sharp, flat, sharp, flat outward from the centre (Surge's odd-index flip). Then each channel holds a balanced spread and the image doesn't lean. Both are A/B listening calls. Neither is a "correctness" fix.

### 2.6 Envelopes and click-free retriggers

**What the reference synths do**

- **Surge's "Analog" ADSR** charges toward `v_cc = 1.5` (an RC charge aimed past full scale, switching to decay on crossing 1.0), decays exponentially toward sustain and releases toward 0. Its "Digital" mode offers sqrt / linear / square attack shapes and power-shaped decay and release. Both modes retrigger from the current level (`retriggerFrom` / `attackFrom(start)`, which back-computes the phase so the output stays continuous) ([ADSRModulationSource.h](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/modulators/ADSRModulationSource.h)).
- **Vital:** `attack_power` defaults to 0 (linear). `decay_power` and `release_power` default to -2 (curved) and are user-adjustable from -20 to 20 ([synth_parameters.cpp](https://github.com/mtytel/vital/blob/main/src/common/synth_parameters.cpp)).

**OSC-8 today** (`envelope.rs`). Linear attack (minimum 1 ms), exponential decay and release (4.6 time constants, so "time" means -40 dB, minimum release 3 ms), idle below 1e-4, retrigger from the current level, and legato `resume()`. This is already in line with Vital's defaults and Surge's retrigger behaviour.

**Recommended (low priority).** Add an attack-curve option: an RC charge toward 1.5, as in Surge's analog mode, gives a snappier "analog" onset. The decay and release curves are fine. One click risk to note: square and saw LFOs routed to level or pan are only smoothed by the 16-sample control ramp (about 0.33 ms), which can click. An LFO "smooth" amount, or a slew on the mod output, would help. Serum 2 instead lets users *disable* its default smoothing for hard edges (User Guide p. 320), which shows the default should be smoothed.

### 2.7 Modulation smoothing and zipper noise

**What the reference synths do.** Surge sets per-block targets and ramps gain and pan linearly across the oversampled block (`(Gain - FBP.Gain) * BLOCK_SIZE_OS_INV`), and smooths velocity with a slow exponential ([SurgeVoice.cpp](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/SurgeVoice.cpp)). Vital ramps drive, reverb decay and similar values per sample (ladder and reverb sources above). Simper's "Dynamic Smoothing" adapts a smoother's cutoff to how fast the control is changing, which suits stepped MIDI CCs ([DynamicSmoothing.pdf](https://cytomic.com/files/dsp/DynamicSmoothing.pdf)).

**OSC-8 today.** Knobs pass through one-pole smoothers at control rate, and per-voice control values ramp linearly per sample over 16 samples. Pitch increments are held for each 16-sample tick, so phase stays continuous but frequency moves in steps. This matches common practice.

**Recommended (low priority).** For fast pitch envelopes (kick- or zap-style), ramp the increment per sample: multiply by `(inc_target/inc)^(1/16)` each sample, or ramp linearly, since the ratio is close to 1. Use Simper's dynamic smoother for mod wheel and MIDI CC input.

### 2.8 Output stage, DC blocking and gain staging

**What the reference synths do.** Vital's final stage is a *hard* `Clamp(-2.1, 2.1)` after the volume control, i.e. a safety limit far above 0 dBFS, not a colouring stage ([sound_engine.cpp](https://github.com/mtytel/vital/blob/main/src/synthesis/synth_engine/sound_engine.cpp)). JOS's DC blocker is `y[n] = x[n] - x[n-1] + R·y[n-1]`, with "R = 0.995 is good" at 44.1 kHz. It is needed wherever DC can build up, such as feedback loops or summed sources ([JOS, DC Blocker](https://ccrma.stanford.edu/~jos/filters/DC_Blocker.html)).

**OSC-8 today** (`engine.rs`). `soft_clip = tanh` on `synth·volume + drums`, with no oversampling and no DC blocker. The doc comment says it is "transparent at low level". From tanh's Taylor series, a sine of peak *a* gets a 3rd harmonic of about a²/12 relative: **-46 dB at a = 0.25, -34 dB at a = 0.5, around -27 dB at a = 0.8**. That isn't transparent for a normal mix level. Because it runs at 1x, the harmonics of high notes alias, and chords intermodulate. Per-voice headroom is `VOICE_GAIN = 0.5`, so a few voices with unison can easily sit in that range.

**Recommended.** Replace it with a knee clipper: identity up to a threshold *t* of about 0.8, then a smooth curve to ±1, for example `t + (1-t)·tanh((|x|-t)/(1-t))` with the sign restored. Optionally apply ADAA1 to the knee region. Put a DC blocker (R ≈ 1 - 2π·10/sr) before the clipper. Wavetables and the symmetric tanh produce no DC, but FX feedback, the asymmetric tube shaper (which has its own blocker) and future features might. Then re-check gain staging so a typical patch peaks around -6 dBFS before the clipper.

### 2.9 Effects: chorus and reverb

**Chorus.** Dattorro: linear interpolation in modulated delays causes "a significant perceived loss of high-frequency content", not caused by the comb filtering itself. He recommends all-pass interpolation, or better ([Effect Design Part 2, §4.3](https://ccrma.stanford.edu/~dattorro/EffectDesignPart2.pdf)). OSC-8's chorus (`fx/chorus.rs`) reads 3 voices per side with `DelayLine::read` (linear). *Recommended:* add a 4-point cubic `read_cubic` to `DelayLine` (all-pass interpolation is the other option Dattorro gives, but it is awkward with fast modulation) and use it in the chorus. A mild low-pass on the wet signal is common in BBD-style choruses, but I have no primary source for that, so treat it as taste.

**Reverb.** Dattorro's plate reverb modulates tank delay taps "at a rate on the order of 1 Hz" with a peak excursion of about 8 samples at 29.8 kHz. "Without the modulation, we may well describe the imaginary space … as being enclosed by a picket fence", and ideally all tank delays are modulated at different rates ([Effect Design Part 1, §1.3.7](https://ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf)). Vital's FDN reverb chorus-modulates its feedback reads with opposite-signed modulation across containers, and keeps in-loop high and low shelves ([reverb.cpp](https://github.com/mtytel/vital/blob/main/src/synthesis/effects/reverb.cpp)). Surge's manual says its Reverb 2 "is more natural and contains less digital artifacts" than Reverb 1 ([Surge XT manual](https://surge-synthesizer.github.io/manual-xt/)). OSC-8's reverb (`fx/reverb.rs`) is an 8-line Hadamard FDN with fixed lengths, one-pole damping and 4 allpass diffusers per side. *Recommended:* add slow sine modulation, a few samples deep, to 4 of the 8 line reads at different rates (0.5–1.3 Hz) and with quadrature phases. Lines are already read with fractional delay, so this costs one LFO step per line. Optionally scale the depth with Size.

### 2.10 Not researched or not verified

- **Arturia Pigments:** I did not consult its manual this session, so I make no claims about it.
- **Zavalishin's book and Szabo's supersaw thesis:** I could not retrieve either (see above).
- **Diva's internal oversampling factors per accuracy mode:** the manual describes quality tiers, not factors, so I don't state any.

---

## 3. Recommendations: what to change, where, cost, and how to verify

### R1. Mip margin and boundary crossfade (`wavetable.rs`, `synth.rs`)
- **Change:** Add `Wavetable::level_frac(freq, sr) -> f32` using an allowed top frequency of `max(sr/2, sr - 18000)`. Keep `level_for` as `floor`. In `osc_targets`, store `mip = floor` and add a `mip_w` control value (ramped like `C_POS_A`) equal to `clamp((frac - 0.75) * 4, 0, 1)`. In `render_unison` and the sub-oscillator, when `mip_w > 0`, also read level `mip + 1` and lerp. `frame_offsets` already takes a level, so compute a second offset pair.
- **Cost:** The margin costs nothing. The crossfade doubles table reads only for streams in the top quarter-octave of a level, about 25% of notes, so roughly +25% oscillator cost on average, worst case +100% for those notes. Effort is about half a day.
- **Verify:** (1) Unit test: for f just below and above each boundary, the top kept-harmonic frequency changes by less than 1.2x, against 2x today. (2) Render offline a slow glide from C2 to C7 on a saw with the filter off. Compute energy in 12–20 kHz per 20 ms frame, and assert no frame-to-frame jump above ~1.5 dB (today you should see ~6 dB+ steps at F# boundaries). (3) Listen: a 2-octave glide and a wide-vibrato lead should sound continuously bright with no "breaths".

### R2. Filter drive and resonance limiting (`synth.rs: render_segment, Svf::limit, drive_sat`)
- **Change:** Apply `limit` to `v.fl[1]` and `v.fr[1]`. Optionally move the saturator to the stage-2 input. Add ADAA1 to `drive_sat`, which needs one previous-input state per channel per voice, reset with the filter state.
- **Cost:** Negligible for the limit fix. ADAA1 adds one `ln` and one divide per sample per channel per voice when drive > 0. Effort is about half a day including tests.
- **Verify:** Write a test with resonance 1, cutoff 500 Hz, drive 0 against drive 1, on a sustained chord. Measure the level of the resonant peak (band-pass around the cutoff) against the total. With the fix, drive must *reduce* peak-to-total, which does not happen today. For ADAA, render a C6 saw through drive 1, cutoff fully open, and check that inharmonic (non-multiple-of-f0) energy drops by roughly 6–10 dB or more against the current code. Listen with a high note and slow cutoff sweeps at high drive.

### R3. Master stage (`engine.rs: soft_clip, Engine::process`)
- **Change:** Use the knee clipper (identity up to 0.8) plus a 10 Hz DC blocker per channel, before the clipper.
- **Cost:** Negligible. Effort is about an hour. The golden renders will change, so expect to re-baseline them.
- **Verify:** Unit test that `clip(x) == x` for |x| ≤ 0.8 and that output never exceeds ±1. THD test: a 1 kHz sine at 0.5 peak should come out with the 3rd harmonic below -90 dB (today about -34 dB). Listen: dense pads and drums should sound less gritty at the same loudness.

### R4. Cubic phase interpolation on low mips (`wavetable.rs: read`, `synth.rs: render_unison`)
- **Change:** Add `read_cubic` (Catmull-Rom). Each frame needs 2 more guard samples (one before, one after), which means changing `STRIDE` and the guard writes in `from_spectra`. Pick `read` or `read_cubic` per stream once per tick from `o.mip <= 2`.
- **Cost:** About 2x read arithmetic for notes below ~95 Hz only. Memory grows by 2 floats per frame. Effort is about half a day.
- **Verify:** Port the **[sim]** method into a Rust test: render a C1 saw at 48 kHz and require SNR against the analytic band-limited saw of at least 58 dB (today 47 dB). Listen: an exposed sub or reese bass with the filter at 300–800 Hz and resonance up should have less fizz.

### R5. Reverb modulation (`fx/reverb.rs`)
- **Change:** Add a per-line LFO phase with depth around 0.1–0.3 ms and rates of 0.5–1.3 Hz, added to `LINE_MS[k] * scale * ms` for 4 lines.
- **Cost:** Negligible. Effort is about an hour.
- **Verify:** Feed in an impulse with decay 0.8 and compare the spectrogram of the tail: narrow persistent ridges, i.e. metallic modes, should smear out. Listen with snare and hi-hat hits and a bright pluck.

### R6. Drift upgrades (`synth.rs: Voice, control_tick, voice_targets`)
- **Change:** Use `wander: [f32; 2]` and `wander_to: [f32; 2]` for A and B. Optionally add per-unison wander inside `UniOsc`. Add a per-voice `env_var: [f32; 3]` applied when the voice starts. That requires a per-voice `EnvParams` copy, so `render_segment` stops sharing `self.env1.params` and each voice keeps its own scaled params (a few floats).
- **Cost:** Negligible. Effort is half a day to a day.
- **Verify:** Extend `drift_detunes_each_voice_a_little`: with drift 1, A and B of the same voice must differ in cents over time, and env1 release times should vary across voices within ±8%. Listen: held polyphonic pads should "breathe" at drift around 0.3.

### R7. Unison curve and stereo interleave (`synth.rs: UnisonLayout, osc_targets`)
- **Change:** Add a `curve` knob applied to `layout.x` (`sign·|x|^p`). Change the pan mapping so adjacent voices by pitch alternate sides.
- **Cost:** None. Effort is a few hours, plus the param and UI plumbing.
- **Verify:** Unit tests for symmetry and monotonic pitch remain. Add a test that each side's gain-weighted mean detune is about 0. Do an A/B listening check on a 7-voice supersaw in mono and in stereo, including a mono-compatibility check with L+R summed.

### R8. Chorus interpolation (`dsp.rs: DelayLine`, `fx/chorus.rs`)
- **Change:** Add `DelayLine::read_cubic` and use it in the chorus.
- **Cost:** 6 extra multiply-adds per tap. Effort is about an hour.
- **Verify:** Sweep a 10 kHz sine through the chorus at mix 1 and depth 1. The time-averaged level should be within 0.5 dB of dry (linear interpolation loses more). Listen to bright pads with the chorus on.

---

## 4. Sources

Open-source code
- Vital (Matt Tytel), [`synth_oscillator.cpp`](https://github.com/mtytel/vital/blob/main/src/synthesis/producers/synth_oscillator.cpp), [`wavetable.h`](https://github.com/mtytel/vital/blob/main/src/synthesis/lookups/wavetable.h), [`synth_parameters.cpp`](https://github.com/mtytel/vital/blob/main/src/common/synth_parameters.cpp), [`sound_engine.cpp`](https://github.com/mtytel/vital/blob/main/src/synthesis/synth_engine/sound_engine.cpp), [`ladder_filter.cpp`](https://github.com/mtytel/vital/blob/main/src/synthesis/filters/ladder_filter.cpp), [`sallen_key_filter.cpp`](https://github.com/mtytel/vital/blob/main/src/synthesis/filters/sallen_key_filter.cpp), [`reverb.cpp`](https://github.com/mtytel/vital/blob/main/src/synthesis/effects/reverb.cpp)
- Surge XT, [`globals.h`](https://github.com/surge-synthesizer/surge/blob/main/src/common/globals.h), [`WavetableOscillator.cpp`](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/oscillators/WavetableOscillator.cpp), [`SurgeVoice.cpp`](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/SurgeVoice.cpp), [`ADSRModulationSource.h`](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/modulators/ADSRModulationSource.h); sst-basic-blocks [`OscillatorDriftUnisonCharacter.h`](https://github.com/surge-synthesizer/sst-basic-blocks/blob/main/include/sst/basic-blocks/dsp/OscillatorDriftUnisonCharacter.h)

Manuals
- u-he, [Diva User Guide v1.4.8](https://u-he.com/downloads/manuals/plugins/diva/Diva-user-guide.pdf) (sections "Zero Delay Feedback Filters", "Accuracy", "Trimmers")
- Xfer Records, [Serum 2 User Guide](https://xferrecords.com/manual/serum-2) (pp. 37, 43, 46–47, 319–320, 347)
- Surge Synth Team, [Surge XT User Manual](https://surge-synthesizer.github.io/manual-xt/)

Papers, books and slides
- A. Simper (Cytomic), [Linear Trapezoidal Integrated SVF (SvfLinearTrapOptimised2)](https://cytomic.com/files/dsp/SvfLinearTrapOptimised2.pdf); [From Circuit to Code, ADC 2020 slides](https://cytomic.com/files/dsp/adc-2020-andrew-simper-circuit-to-code-slides.pdf); [Dynamic Smoothing](https://cytomic.com/files/dsp/DynamicSmoothing.pdf); index at [cytomic.com/technical-papers](https://cytomic.com/technical-papers/)
- A. Huovilainen, ["Non-Linear Digital Implementation of the Moog Ladder Filter", DAFx-04](https://dafx.de/paper-archive/2004/P_061.PDF)
- J. D. Parker, V. Zavalishin, E. Le Bivic, ["Reducing the Aliasing of Nonlinear Waveshaping Using Continuous-Time Convolution", DAFx-16](https://dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf)
- V. Välimäki, J. Pekonen, J. Nam, ["Perceptually informed synthesis of bandlimited classical waveforms using integrated polynomial interpolation", JASA 131(1), 2012](https://mac.kaist.ac.kr/pubs/ValimakiPeknenNam-jasa2012.pdf)
- O. Niemitalo, ["Polynomial Interpolators for High-Quality Resampling of Oversampled Audio", 2001](https://yehar.com/blog/wp-content/uploads/2009/08/deip.pdf)
- J. Dattorro, ["Effect Design Part 1: Reverberator and Other Filters", JAES 1997](https://ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf); ["Part 2: Delay-Line Modulation and Chorus"](https://ccrma.stanford.edu/~dattorro/EffectDesignPart2.pdf)
- J. O. Smith III, ["DC Blocker", *Introduction to Digital Filters*](https://ccrma.stanford.edu/~jos/filters/DC_Blocker.html)
- Not retrieved this session, not relied on: V. Zavalishin, *The Art of VA Filter Design* (Native Instruments; the URLs for v2.1.0 and 2.1.2 returned 404); A. Szabo, *How to Emulate the Super Saw* (KTH, 2010).

---

## Appendix: how the [sim] numbers were produced

This was a Python and NumPy re-implementation of `Wavetable::from_spectra` (saw spectrum, 2048 samples, 11 levels, peak-normalised by level 0), `Wavetable::level_for`, and `Wavetable::read` (linear), plus a 4-point Catmull-Rom variant. For each note at 48 kHz, it rendered 32768 samples and subtracted the analytic sum of exactly the harmonics the chosen level contains. It then reported signal-to-error power over the full band and with the error restricted to below 16 kHz (Hann-windowed FFT). The "top harmonic" column is `(1024 >> level, capped at 1023) × f`. The script is not part of the repo; the method above is enough to rebuild it as a Rust test.
