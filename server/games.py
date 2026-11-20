# The game modes of a room (web/systems/game.js; documentation/worlds.md "Game modes"). The server keeps the round of
# each room, so all its pages agree; it is not saved in the database.
# Day Night ("daynight"): in the world night-forest, one player of the room (picked at random) is the monster, with a
# sword; the others have a flashlight and check the crates of the world. The players win when every crate is checked,
# the monster when every player is dead. A trap stops whoever walks on it for TRAP_STUCK seconds; it works again
# TRAP_READY seconds after.
# A player is known by its "who": its account (online), else a name its tab keeps (web/systems/net.js). A player gone
# from the room for longer than GONE seconds is dead; the monster gone that long: the players win.
# Messages of a page (not passed on to the others):
#   g-start {mode}   the owner of the room starts a round (on this computer, any page)
#   g-check {i}      a player checked the crate i            g-trap {i}   this player walked on the trap i
#   g-dead           this player is dead
# The server sends to every page of the room (any of its worlds) {t: 'game', ...} (game_state), and g-error {text} to
# the page whose g-start is refused.
import json, os, random, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODES = {'daynight': 'night-forest'}   # mode -> its world (worlds/<world>.json, field "game")
TRAP_STUCK = 5      # seconds
TRAP_READY = 20     # seconds from the moment it caught someone until it works again
GONE = 45           # seconds (a page that changes world reloads and loads the new world meanwhile)

games = {}          # room group (the room code; '' without a room) -> the round
lock = threading.Lock()


def recipe_game(world):
    with open(os.path.join(ROOT, 'worlds', world + '.json')) as f:
        return json.load(f)['game']


def game_state(g):
    now = time.time()
    return {'t': 'game', 'id': g['id'], 'mode': g['mode'], 'world': g['world'], 'phase': g['phase'], 'winner': g['winner'],
            'monster': g['monster'], 'checks': g['checks'], 'checked': sorted(g['checked']),
            'players': [{'who': who, 'name': p['name'], 'dead': p['dead'], 'spot': p['spot']} for who, p in g['players'].items()],
            'traps': {str(i): {'who': t['who'], 'stuck': max(0, t['until'] - now), 'ready': max(0, t['ready'] - now)}
                      for i, t in g['traps'].items() if t['ready'] > now}}


class Games:
    """peers_of(group) -> the Peers of every world of that room now"""

    def __init__(self, peers_of):
        self.peers_of = peers_of
        threading.Thread(target=self.watch, daemon=True).start()

    def send_all(self, group, message):
        for p in self.peers_of(group):
            p.send(message)

    def welcome(self, peer):
        """a page joins: the round of its room, if one runs"""
        with lock:
            g = games.get(peer.group)
            state = game_state(g) if g else None
        if state:
            peer.send(state)

    def message(self, peer, msg):
        """a g-... message of a page"""
        kind, group = msg.get('t'), peer.group
        with lock:
            g = games.get(group)
            if kind == 'g-start':
                error = self.start(peer, msg.get('mode'))
                if error:
                    peer.send({'t': 'g-error', 'text': error})
                    return
                g = games[group]
            elif not g or g['phase'] != 'play' or peer.who not in g['players']:
                return
            elif kind == 'g-check':
                i, me = msg.get('i'), g['players'][peer.who]
                if peer.who == g['monster'] or me['dead'] or not isinstance(i, int) or not 0 <= i < g['checks'] or i in g['checked']:
                    return
                g['checked'].add(i)
                if len(g['checked']) == g['checks']:
                    self.end(g, 'players')
            elif kind == 'g-trap':
                i, now = msg.get('i'), time.time()
                if not isinstance(i, int) or not 0 <= i < g['trap_count'] or g['traps'].get(i, {'ready': 0})['ready'] > now:
                    return
                g['traps'][i] = {'who': peer.who, 'until': now + TRAP_STUCK, 'ready': now + TRAP_READY}
            elif kind == 'g-dead':
                if peer.who == g['monster']:
                    return
                g['players'][peer.who]['dead'] = True
                self.check_dead(g)
            else:
                return
            state = game_state(g)
            if g['phase'] == 'over':
                games.pop(group, None)
        self.send_all(group, state)

    def start(self, peer, mode):
        """-> None (the round starts), or why not"""
        if mode not in MODES:
            return 'No such game mode.'
        if not peer.owner:
            return 'Only the owner of the room can start a game.'
        if peer.group in games:
            return 'A game is already running in this room.'
        players = {}
        for p in self.peers_of(peer.group):
            players.setdefault(p.who, p.name)
        if len(players) < 2:
            return 'You need at least 2 players in the room.'
        world = MODES[mode]
        rec = recipe_game(world)
        who = list(players)
        random.shuffle(who)
        monster = random.choice(who)
        now = time.time()
        games[peer.group] = {
            'id': f'{int(now)}-{random.randrange(1 << 30)}', 'mode': mode, 'world': world, 'phase': 'play', 'winner': None,
            'monster': monster, 'checks': len(rec['checks']), 'checked': set(), 'trap_count': len(rec['traps']), 'traps': {},
            'players': {w: {'name': players[w], 'dead': False, 'spot': i, 'seen': now} for i, w in enumerate(who)},
        }
        print(f'[game] {mode} starts in room {peer.group or "-"}: {len(who)} players, monster {players[monster]}', flush=True)
        return None

    def check_dead(self, g):
        if all(p['dead'] for w, p in g['players'].items() if w != g['monster']):
            self.end(g, 'monster')

    def end(self, g, winner):
        g['phase'], g['winner'] = 'over', winner
        print(f'[game] {g["mode"]} ends: the {winner} win', flush=True)

    def watch(self):
        """every 2 s: a player gone too long is dead; the monster gone too long: the players win"""
        while True:
            time.sleep(2)
            now, ended = time.time(), []
            with lock:
                for group, g in list(games.items()):
                    here = {p.who for p in self.peers_of(group)}
                    changed = False
                    for who, p in g['players'].items():
                        if who in here:
                            p['seen'] = now
                        elif now - p['seen'] > GONE and not p['dead']:
                            if who == g['monster']:
                                self.end(g, 'players')
                            else:
                                p['dead'] = True
                                self.check_dead(g)
                            changed = True
                    if not here and all(now - p['seen'] > GONE for p in g['players'].values()):
                        games.pop(group, None)
                        continue
                    if changed:
                        ended.append((group, game_state(g)))
                        if g['phase'] == 'over':
                            games.pop(group, None)
            for group, state in ended:
                self.send_all(group, state)
