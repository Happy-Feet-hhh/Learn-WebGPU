struct VertexOut {
    @builtin(position) position: vec4f, // 顶点在裁剪空间中的位置
    @location(0) color: vec4f
}

@vertex
fn vertexMain(
    @location(0) pos: vec2f,    // 顶点的xy坐标
    @location(1) color: vec3f,  // rgb颜色值
) -> VertexOut {
    var output: VertexOut;
    output.position = vec4f(pos, 0.0, 1.0);
    output.color = vec4f(color, 1.0);

    return output;
}

// 片段着色器会针对三角形中的每个像素进行调用。
@fragment
fn fragmentMain(fragData: VertexOut) -> @location(0) vec4f {
    return fragData.color; // 像素的最终颜色
}