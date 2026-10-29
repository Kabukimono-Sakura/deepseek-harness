using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class ControlPanel : Form
{
    private readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    private readonly Label qqState = new Label(), petState = new Label(), notice = new Label();
    private readonly List<Button> actions = new List<Button>();
    private readonly System.Windows.Forms.Timer poll = new System.Windows.Forms.Timer();
    private readonly NotifyIcon tray = new NotifyIcon();
    private bool busy, refreshing, exiting;
    private Button qqOn, qqOff, petOn, petOff;
    private readonly Color ink = Color.FromArgb(67, 42, 56), pink = Color.FromArgb(195, 83, 132);

    public ControlPanel()
    {
        SuspendLayout();
        Text = "Deepseek Harness 控制面板";
        ClientSize = new Size(760, 590); MinimumSize = new Size(776, 629);
        FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen; AutoScaleMode = AutoScaleMode.None;
        Font = new Font("Microsoft YaHei UI", 16F, FontStyle.Regular, GraphicsUnit.Pixel); ForeColor = ink;
        BackColor = Color.FromArgb(255, 246, 250); Icon = SystemIcons.Application;
        Label title = LabelAt(this, "Deepseek Harness", 24, 20, 650, 38);
        title.Font = new Font(Font.FontFamily, 26F, FontStyle.Bold, GraphicsUnit.Pixel);
        LabelAt(this, "Elysia的粉色大肥鱼 · 本机控制面板", 27, 66, 680, 25).ForeColor = Color.FromArgb(125, 92, 109);

        Panel qq = Card(24, 108, 712, 156);
        LabelAt(qq, "QQ 聊天", 18, 12, 260, 28).Font = new Font(Font.FontFamily, 18F, FontStyle.Bold, GraphicsUnit.Pixel);
        AddState(qq, qqState, 18, 44, "正在检查 QQ 状态…");
        LabelAt(qq, "停用会关闭自动回复与主动消息，保留 QQ 登录。", 18, 71, 670, 23).ForeColor = Color.DimGray;
        qqOn = ActionButton(qq, "启用 QQ", 18, 106, "qq-start");
        qqOff = ActionButton(qq, "停用 QQ", 144, 106, "qq-stop");
        ActionButton(qq, "扫码登录", 270, 106, "login");

        Panel pet = Card(24, 280, 712, 132);
        LabelAt(pet, "桌宠", 18, 10, 260, 28).Font = new Font(Font.FontFamily, 18F, FontStyle.Bold, GraphicsUnit.Pixel);
        AddState(pet, petState, 18, 41, "正在检查桌宠状态…");
        LabelAt(pet, "关闭时隐藏桌宠，显示服务留在后台待机。", 290, 46, 400, 40).ForeColor = Color.DimGray;
        petOn = ActionButton(pet, "打开桌宠", 18, 87, "pet-start");
        petOff = ActionButton(pet, "关闭桌宠", 144, 87, "pet-stop");

        ActionButton(this, "全部启用", 24, 430, "all-start");
        ActionButton(this, "全部停用", 150, 430, "all-stop");
        Button logs = PlainButton(this, "查看日志", 372, 430); logs.Click += delegate { OpenFolder("tmp"); };
        Button folder = PlainButton(this, "项目文件夹", 498, 430); folder.Click += delegate { OpenFolder(""); };
        Button exit = PlainButton(this, "退出面板", 624, 430); exit.Width = 112;
        exit.Click += delegate { exiting = true; Close(); };

        notice.SetBounds(24, 486, 712, 55); notice.BackColor = Color.FromArgb(250, 230, 239);
        notice.Padding = new Padding(12, 8, 8, 4); notice.Text = "准备就绪。所有数据保存在当前项目文件夹。";
        Controls.Add(notice);
        LabelAt(this, "关闭窗口会收进托盘；退出面板也不会停止已运行的服务。", 24, 553, 710, 25).ForeColor = Color.DimGray;

        tray.Icon = Icon; tray.Text = "Deepseek Harness 控制面板"; tray.Visible = true;
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("显示控制面板", null, delegate { Restore(); });
        menu.Items.Add("退出面板（保留服务）", null, delegate { exiting = true; Close(); });
        tray.ContextMenuStrip = menu; tray.DoubleClick += delegate { Restore(); };
        poll.Interval = 5000; poll.Tick += async delegate { await RefreshStatus(); };
        Shown += async delegate { poll.Start(); await RefreshStatus(); };
        FormClosing += delegate(object sender, FormClosingEventArgs e) {
            if (!exiting && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); }
            else { poll.Stop(); tray.Visible = false; tray.Dispose(); }
        };
        ResumeLayout(false);
    }
    private void Restore() { Show(); WindowState = FormWindowState.Normal; Activate(); }
    private Panel Card(int x, int y, int w, int h) {
        Panel panel = new Panel(); panel.SetBounds(x, y, w, h); panel.BackColor = Color.White; Controls.Add(panel); return panel;
    }
    private Label LabelAt(Control parent, string text, int x, int y, int width, int height) {
        Label label = new Label(); label.Text = text; label.SetBounds(x, y, width, height); parent.Controls.Add(label); return label;
    }
    private void AddState(Control parent, Label label, int x, int y, string text) {
        label.Text = text; label.SetBounds(x, y, 670, 25); label.ForeColor = Color.DimGray; parent.Controls.Add(label);
    }
    private Button PlainButton(Control parent, string text, int x, int y) {
        Button button = new Button(); button.Text = text; button.SetBounds(x, y, 112, 36);
        button.FlatStyle = FlatStyle.Flat; button.FlatAppearance.BorderColor = Color.FromArgb(224, 187, 204);
        button.BackColor = Color.White; button.ForeColor = ink; button.Cursor = Cursors.Hand; parent.Controls.Add(button); return button;
    }
    private Button ActionButton(Control parent, string text, int x, int y, string command) {
        Button button = PlainButton(parent, text, x, y); actions.Add(button);
        if (command.EndsWith("start")) { button.BackColor = pink; button.ForeColor = Color.White; button.FlatAppearance.BorderSize = 0; }
        button.Click += async delegate { await RunAction(command); }; return button;
    }
    private void OpenFolder(string name) {
        string path = Path.Combine(root, name); Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo("explorer.exe", "\"" + path + "\"") { UseShellExecute = true });
    }
    private Dictionary<string, object> Call(string command) {
        string node = Path.Combine(root, ".tools", "node", "node.exe");
        string script = Path.Combine(root, "scripts", "dashboard.mjs");
        if (!File.Exists(node) || !File.Exists(script)) throw new Exception("请将面板放在项目根目录，保留 .tools 和 scripts 文件夹。");
        ProcessStartInfo start = new ProcessStartInfo(node, "\"" + script + "\" " + command);
        start.WorkingDirectory = root; start.UseShellExecute = false; start.CreateNoWindow = true;
        start.RedirectStandardOutput = true; start.RedirectStandardError = true;
        start.StandardOutputEncoding = Encoding.UTF8; start.StandardErrorEncoding = Encoding.UTF8;
        using (Process process = Process.Start(start)) {
            Task<string> output = process.StandardOutput.ReadToEndAsync();
            Task<string> errors = process.StandardError.ReadToEndAsync();
            process.WaitForExit(); Task.WaitAll(output, errors);
            try { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(output.Result.Trim()); }
            catch { throw new Exception("服务控制未返回有效结果，请查看项目日志。"); }
        }
    }
    private string Value(Dictionary<string, object> data, string key) { object value; return data.TryGetValue(key, out value) ? Convert.ToString(value) : ""; }
    private async Task RunAction(string command) {
        if (busy) return; busy = true; foreach (Button button in actions) button.Enabled = false;
        notice.Text = command.Contains("stop") ? "正在安全停止，若正在回复，会等待它完成收尾…" : "正在处理，首次打开桌宠可能需要几十秒…";
        try {
            Dictionary<string, object> data = await Task.Run(() => Call(command));
            notice.Text = Value(data, "message");
            string url = Value(data, "url"); Uri target;
            if (Value(data,"ok").Equals("True", StringComparison.OrdinalIgnoreCase) && Uri.TryCreate(url, UriKind.Absolute, out target) && target.Scheme == "http" && target.Host == "127.0.0.1") Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        } catch (Exception error) { notice.Text = error.Message; }
        finally { busy = false; foreach (Button button in actions) button.Enabled = true; }
        await RefreshStatus();
    }
    private async Task RefreshStatus() {
        if (busy || refreshing || IsDisposed) return; refreshing = true;
        try {
            Dictionary<string, object> data = await Task.Run(() => Call("status"));
            if(IsDisposed) return;
            ApplyStatus(data);
        } catch (Exception error) { if(!IsDisposed) notice.Text = error.Message; }
        finally { refreshing = false; }
    }
    private void ApplyStatus(Dictionary<string, object> data) {
            string qq = Value(data,"qq"), pet = Value(data,"pet");
            qqState.Text = qq == "connected" ? "● 已连接，可以聊天" : qq == "waiting" ? "● 聊天已启用，等待登录或重连" : qq == "starting" ? "● 正在启动 / 等待状态更新" : "○ QQ 聊天已停用";
            qqState.ForeColor = qq == "connected" ? Color.FromArgb(48,130,92) : Color.FromArgb(141,106,69);
            petState.Text = pet == "shown" ? "● 桌宠已打开" : pet == "hidden" ? "○ 桌宠已关闭，服务待机" : "○ 桌宠未启动";
            petState.ForeColor = pet == "shown" ? Color.FromArgb(48,130,92) : Color.DimGray;
            if(!busy) { qqOn.Enabled = qq == "stopped"; qqOff.Enabled = qq != "stopped"; petOn.Enabled = pet != "shown"; petOff.Enabled = pet == "shown"; }
    }
    [STAThread]
    public static void Main(string[] args) {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        if (Array.IndexOf(args,"--self-test") >= 0) {
            using(ControlPanel form = new ControlPanel()) {
                Directory.CreateDirectory(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"tmp"));
                File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"tmp","panel-self-test.json"),"{\"ok\":true,\"actions\":"+form.actions.Count+"}");
                if(File.Exists(Path.Combine(form.root,".tools","node","node.exe"))) {
                    form.ApplyStatus(form.Call("status"));
                    form.Show(); Application.DoEvents(); form.PerformLayout();
                    using(Bitmap preview = new Bitmap(form.Width,form.Height)) {
                        form.DrawToBitmap(preview,new Rectangle(0,0,form.Width,form.Height));
                        preview.Save(Path.Combine(form.root,"tmp","panel-preview.png"),System.Drawing.Imaging.ImageFormat.Png);
                    }
                    form.exiting = true; form.Close();
                }
                form.tray.Visible = false; form.tray.Dispose();
                Environment.ExitCode = form.actions.Count == 7 ? 0 : 1;
            } return;
        }
        bool created;
        using(Mutex mutex = new Mutex(true,"Local\\DeepseekHarnessControlPanel",out created)) {
            if(!created) { MessageBox.Show("面板已经打开，可以从任务栏或系统托盘恢复。","Deepseek Harness"); return; }
            Application.Run(new ControlPanel());
        }
    }
}
