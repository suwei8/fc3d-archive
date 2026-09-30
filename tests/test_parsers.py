from scripts.collect import parse_taihu, parse_tianqi


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
