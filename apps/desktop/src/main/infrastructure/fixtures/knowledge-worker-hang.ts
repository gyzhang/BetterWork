/**
 * 测试替身：模拟一个卡死的提取 Worker——不回应任何请求，也无视 shutdown。
 * 用于验证运行器「取消后 1 秒宽限、只终止已登记 pid」的收口路径（知识契约 §8.2）。
 */
process.stdin.resume();
