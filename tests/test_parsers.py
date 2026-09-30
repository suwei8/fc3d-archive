from scripts.collect import (
    discover_cz89_nightly_url,
    parse_cz89_nightly,
    parse_taihu,
    parse_tianqi,
)


def test_parse_tianqi_history_row():
    html = """
    <table>
      <tr><th>期数</th><th>日期</th><th>开机号</th><th>试机号</th><th>关注码</th><th>金码</th><th>对应码</th><th>开奖号</th></tr>
      <tr><td>2026258</td><td>09-25</td><td>364</td><td>018</td><td>546</td><td>5</td><td>369</td><td>635</td></tr>
    </table>
    """
    assert parse_tianqi(html)["2026258"] == {
        "trial_number": "018",
        "focus": "546",
        "gold": "5",
        "corresponding": "369",
    }


def test_parse_taihu_history_row():
    html = """
    <table>
      <tr><th>期号</th><th>开奖号</th><th>试机号</th><th>太湖一语</th></tr>
      <tr><td>2026258</td><td>635</td><td>018</td><td>山君坐镇</td></tr>
    </table>
    """
    assert parse_taihu(html)["2026258"] == "山君坐镇"


def test_discover_cz89_nightly_url_for_issue():
    html = """
    <html><body>
      <a href="/read_10852801.htm">26年263期福彩3D晚间字谜汇总大全</a>
      <a href="/read_other.htm">26年263期牛彩网福彩3D字谜汇总大全〖晚间版〗</a>
    </body></html>
    """
    assert (
        discover_cz89_nightly_url(html, "2026263")
        == "https://m.cz89.com/read_10852801.htm"
    )


def test_parse_cz89_nightly_2026258_golden_fields():
    html = """
    <html><body>
      <p>千禧3D试机号2026年258期：</p>
      <p>试机号018</p>
      <p>关注码546</p>
      <p>金码5</p>
      <p>对应码：[369]</p>
      <p>牛彩关注码 9,5,4</p>
      <p>牛彩网关注码：1,3</p>
      <p>金码：8</p>
      <p>北京试机号谜语 踏霜行</p>
      <p>另版北京试机号谜语 其它内容</p>
      <p>太湖一语定胆 山君坐镇</p>
    </body></html>
    """
    assert parse_cz89_nightly(html) == {
        "beijing": "踏霜行",
        "bottom_focus": ["1", "3"],
        "bottom_gold": "8",
    }


def test_parse_cz89_nightly_2026263_current_shape():
    html = """
    <html><body>
      <p>试机号395</p>
      <p>关注码804</p>
      <p>金码8</p>
      <p>对应码：[048]</p>
      <p>牛彩关注码 1,8,5</p>
      <p>牛彩网关注码：6,9</p>
      <p>金码：5</p>
      <p>北京试机号谜语 访古寺</p>
      <p>另版北京试机号谜语 走天涯</p>
      <p>太湖一语定胆 摸哨</p>
    </body></html>
    """
    assert parse_cz89_nightly(html) == {
        "beijing": "访古寺",
        "bottom_focus": ["6", "9"],
        "bottom_gold": "5",
    }
