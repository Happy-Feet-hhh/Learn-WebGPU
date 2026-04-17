/**
 * EffectsFactory - 后处理效果工厂类
 *
 * 【工厂模式概述】
 * 工厂模式（Factory Pattern）是一种创建型设计模式，它将对象的创建逻辑集中管理。
 * 本类作为所有后处理效果的统一创建入口，提供以下优势：
 *   1. 统一管理 GPUDevice 和尺寸参数，避免在每个效果类中重复传递
 *   2. 封装创建和初始化流程（new + initialize），简化外部调用
 *   3. 便于扩展新的后处理效果类型
 *
 * 【后处理效果类型】
 * 本工厂可以创建以下四种后处理效果：
 *
 *   PostProcessEffect  - 基础后处理：将纹理通过全屏四边形渲染到目标
 *                        用途：最简单的纹理复制/显示效果
 *
 *   TextureEffect      - 纹理混合：将两张纹理按 mixValue 线性混合
 *                        用途：场景与特效纹理的叠加（如模糊纹理与原始场景混合）
 *
 *   BlurEffect         - 高斯模糊：双通道分离式模糊（水平+垂直）
 *                        用途：独立的模糊效果，如景深模糊、运动模糊的基础
 *
 *   BloomEffect        - 泛光效果：提取高亮区域 → 多次模糊 → 合成
 *                        用途：模拟强光源的光晕扩散，增强画面真实感和氛围
 *
 * 【后处理管线架构】
 * 典型的后处理管线组合：
 *
 *   场景渲染 → [PostProcessEffect] → 屏幕
 *   （最简单的直通模式）
 *
 *   场景渲染 → [BlurEffect] → 屏幕
 *   （全屏模糊效果）
 *
 *   场景渲染 → sceneTexture ──┐
 *              ↓              ├→ [TextureEffect] → 屏幕
 *              [BlurEffect] ──┘
 *   （场景 + 模糊混合）
 *
 *   场景渲染 → sceneTexture ────────────────────┐
 *              ↓                                  ├→ [合成] → 屏幕
 *              亮度提取 → [BloomBlur×10] ─────────┘
 *   （完整的泛光效果，由 BloomEffect 内部管理）
 */

import { BloomEffect } from "./bloom-effect";
import { BlurEffect } from "./blur-effect";
import { PostProcessEffect } from "./post-process-effect";
import { TextureEffect } from "./texture-effect";

/**
 * 后处理效果工厂
 * 集中管理所有后处理效果的创建和初始化过程。
 */
export class EffectsFactory {
    /**
     * 构造函数
     * @param device - GPU 设备，所有效果共享同一个设备实例
     * @param width  - 渲染目标宽度（像素），所有效果共享同一尺寸
     * @param height - 渲染目标高度（像素）
     */
    constructor(private device: GPUDevice,
        private width: number,
        private height: number) {

    }

    /**
     * 创建基础后处理效果。
     * PostProcessEffect 将输入纹理通过全屏四边形渲染到目标纹理，
     * 是最简单的后处理单元，也可以作为更复杂效果的基础组件。
     *
     * @returns 初始化完成的 PostProcessEffect 实例
     */
    public async createPostProcessEffect(): Promise<PostProcessEffect> {
        const effect = new PostProcessEffect(this.device, this.width, this.height);
        await effect.initialize();
        return effect;
    }

    /**
     * 创建纹理混合效果。
     * TextureEffect 支持两张纹理的线性混合，混合比例由 mixValue 控制。
     * 需要在外部调用 setCombineTexture() 设置第二张纹理。
     *
     * @returns 初始化完成的 TextureEffect 实例
     */
    public async createTextureEffect(): Promise<TextureEffect> {
        const effect = new TextureEffect(this.device, this.width, this.height);
        await effect.initialize();
        return effect;
    }

    /**
     * 创建高斯模糊效果。
     * BlurEffect 实现双通道分离式高斯模糊：
     *   水平通道 → 垂直通道
     * 可以通过 doHorizontalPass / doVerticalPass 开关单独控制每个通道。
     *
     * @returns 初始化完成的 BlurEffect 实例
     */
    public async createBlurEffect(): Promise<BlurEffect> {
        const effect = new BlurEffect(this.device, this.width, this.height);
        await effect.initialize();
        return effect;
    }

    /**
     * 创建泛光效果。
     * BloomEffect 实现完整的泛光管线：
     *   亮度提取 → 10次乒乓模糊 → 场景与高亮叠加
     * 内部自动管理 BloomBlurEffect 子效果。
     *
     * @returns 初始化完成的 BloomEffect 实例
     */
    public async createBloomEffect(): Promise<BloomEffect> {
        const effect = new BloomEffect(this.device, this.width, this.height);
        await effect.initialize();
        return effect;
    }
}
