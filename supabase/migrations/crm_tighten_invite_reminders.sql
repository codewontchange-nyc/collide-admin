-- Win back stage-0 (invited, never signed in) faster: send the first invite
-- reminder a day after the invite instead of two, and the second at day 4
-- instead of 6, while intent is still warm.
update crm_campaigns set day_offset=1 where stage=0 and step=1;
update crm_campaigns set day_offset=4 where stage=0 and step=2;
